/**
 * A very small stand-in for the browser DOM, so the dialogs can be tested in
 * plain Node without adding a dependency.
 *
 * It implements only what src/lib/ui.js, picker.js and entry-editor.js use:
 * building elements, simple selectors (`tag`, `.class`, `tag.class`, comma
 * lists), events that bubble up to `document`, and the value rules of
 * <input type="time"> and <input type="date">. It does no layout and no
 * rendering. If a module starts using a DOM feature that is missing here, add it
 * here rather than working around it in the test.
 */

const TIME_VALUE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?$/;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const VOID_TAGS = new Set(['input', 'br', 'hr', 'img']);

export class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    this.key = init.key;
    this.target = null;
    this.defaultPrevented = false;
    this.stopped = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; this.stoppedNow = true; }
}

export class Node {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = new Map();
  }

  append(...nodes) {
    for (let n of nodes) {
      if (!(n instanceof Node)) n = new Text(String(n));
      n.remove();
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  remove() {
    if (!this.parentNode) return;
    const list = this.parentNode.childNodes;
    list.splice(list.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(text) {
    for (const c of this.childNodes.slice()) c.remove();
    if (text !== '' && text != null) this.append(new Text(String(text)));
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (list?.includes(fn)) list.splice(list.indexOf(fn), 1);
  }
  /** Runs listeners on this node, then on each ancestor, like the bubble phase. */
  dispatchEvent(event) {
    event.target = this;
    for (let n = this; n; n = n.parentNode) {
      for (const fn of (n.listeners.get(event.type) || []).slice()) {
        fn.call(n, event);
        if (event.stoppedNow) break;
      }
      if (event.stopped || !event.bubbles) break;
    }
    return !event.defaultPrevented;
  }

  /** Every element below this node, in document order. */
  descendants() {
    const out = [];
    for (const c of this.childNodes) {
      if (c instanceof Element) { out.push(c); out.push(...c.descendants()); }
    }
    return out;
  }
  querySelectorAll(selector) {
    const parts = selector.split(',').map((s) => s.trim());
    return this.descendants().filter((e) => parts.some((p) => e.matches(p)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

export class Text extends Node {
  constructor(text) { super(); this.text = text; }
  get textContent() { return this.text; }
  set textContent(text) { this.text = String(text); }
}

class ClassList {
  constructor(element) { this.element = element; }
  list() { return this.element.className.split(/\s+/).filter(Boolean); }
  contains(name) { return this.list().includes(name); }
  add(name) { if (!this.contains(name)) this.element.className = [...this.list(), name].join(' '); }
  remove(name) { this.element.className = this.list().filter((c) => c !== name).join(' '); }
  toggle(name, force = !this.contains(name)) {
    if (force) this.add(name); else this.remove(name);
    return force;
  }
}

export class Element extends Node {
  constructor(tag, ownerDocument) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.classList = new ClassList(this);
    this.style = {};
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get id() { return this.getAttribute('id') || ''; }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(on) { if (on) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get type() { return this.getAttribute('type') || (this.tagName === 'INPUT' ? 'text' : ''); }

  /** Browsers drop a value that is not valid for the input's type. */
  sanitize(value) {
    if (this.type === 'time') return TIME_VALUE.test(value) ? value : '';
    if (this.type === 'date') return DATE_VALUE.test(value) ? value : '';
    return value;
  }
  get value() { return this.sanitize(this.dirtyValue ?? this.getAttribute('value') ?? ''); }
  set value(v) { this.dirtyValue = String(v); }
  get checked() { return this.dirtyChecked ?? this.hasAttribute('checked'); }
  set checked(on) { this.dirtyChecked = !!on; }

  get children() { return this.childNodes.filter((c) => c instanceof Element); }

  /** Supports `tag`, `.class`, and both combined — nothing more. */
  matches(selector) {
    const [tag, ...classes] = selector.split('.');
    if (tag && tag.toUpperCase() !== this.tagName) return false;
    return classes.every((c) => this.classList.contains(c));
  }

  set innerHTML(html) {
    for (const c of this.childNodes.slice()) c.remove();
    parseInto(this, html);
  }

  /** Moves focus here; `blur` and `focus` do not bubble, as in a browser. */
  focus() {
    const doc = this.ownerDocument;
    if (doc.activeElement === this) return;
    const previous = doc.activeElement;
    doc.activeElement = this;
    previous.dispatchEvent(new Event('blur', { bubbles: false }));
    this.dispatchEvent(new Event('focus', { bubbles: false }));
  }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.body.focus(); }
  click() { this.dispatchEvent(new Event('click')); }
  scrollIntoView() {}
}

/** Parses the static templates the source uses: tags, attributes and text. */
function parseInto(root, html) {
  const token = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  const attr = /([^\s=]+)(?:="([^"]*)")?/g;
  let parent = root;
  for (const [, closing, tag, attrs, selfClosing, text] of html.matchAll(token)) {
    if (text !== undefined) {
      if (text.trim()) parent.append(new Text(text));
    } else if (closing) {
      parent = parent.parentNode;
    } else {
      const node = new Element(tag, root.ownerDocument);
      for (const [, name, value] of attrs.matchAll(attr)) node.setAttribute(name, value ?? '');
      parent.append(node);
      if (!selfClosing && !VOID_TAGS.has(tag.toLowerCase())) parent = node;
    }
  }
}

export class Document extends Node {
  constructor() {
    super();
    this.body = new Element('body', this);
    this.append(this.body);
    this.activeElement = this.body;
  }
  createElement(tag) { return new Element(tag, this); }
  createTextNode(text) { return new Text(text); }
  getElementById(id) { return this.descendants().find((e) => e.id === id) || null; }
}

/** Installs a fresh `document` (and `Node`) as globals and returns the document. */
export function installDom() {
  globalThis.Node = Node;
  globalThis.document = new Document();
  return globalThis.document;
}
