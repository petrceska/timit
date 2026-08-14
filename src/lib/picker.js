/**
 * Project combobox: type to filter existing projects, or create a new one by
 * typing a name that doesn't exist yet. Used by the popup and the dashboard.
 */
import { Store, safeColor } from './store.js';

export class ProjectPicker {
  /**
   * @param {HTMLElement} root  empty element the picker is rendered into
   * @param {object} opts  { onChange(projectId), allowClear, placeholder }
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = { allowClear: true, placeholder: 'Project', ...opts };
    this.projects = [];
    this.value = null;
    this.highlight = 0;
    this.rows = [];
    this._build();
    document.addEventListener('click', (e) => {
      if (!this.root.contains(e.target)) this.close();
    });
  }

  _build() {
    this.root.classList.add('picker');
    this.root.innerHTML = `
      <button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded="false">
        <span class="dot" hidden></span>
        <span class="picker-label"></span>
        <svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
      <div class="picker-pop" hidden>
        <input type="text" class="picker-search" placeholder="Find or create a project…" autocomplete="off" spellcheck="false">
        <ul class="picker-list" role="listbox"></ul>
      </div>`;
    this.btn = this.root.querySelector('.picker-btn');
    this.dot = this.root.querySelector('.dot');
    this.label = this.root.querySelector('.picker-label');
    this.pop = this.root.querySelector('.picker-pop');
    this.search = this.root.querySelector('.picker-search');
    this.list = this.root.querySelector('.picker-list');

    this.btn.addEventListener('click', () => (this.pop.hidden ? this.open() : this.close()));
    this.search.addEventListener('input', () => { this.highlight = 0; this._renderList(); });
    this.search.addEventListener('keydown', (e) => this._onKey(e));
    this._renderButton();
  }

  async refresh() {
    this.projects = (await Store.getProjects()).filter((p) => !p.archived || p.id === this.value);
    this._renderButton();
    if (!this.pop.hidden) this._renderList();
  }

  async open() {
    await this.refresh();
    this.pop.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    this.search.value = '';
    this.highlight = 0;
    this._renderList();
    this.search.focus();
  }

  close() {
    this.pop.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
  }

  getValue() { return this.value; }

  async setValue(id, { silent = true } = {}) {
    this.value = id || null;
    if (!this.projects.length) this.projects = await Store.getProjects();
    this._renderButton();
    if (!silent) this.opts.onChange?.(this.value);
  }

  _renderButton() {
    const p = this.projects.find((x) => x.id === this.value);
    this.dot.hidden = !p;
    if (p) this.dot.style.background = safeColor(p.color);
    this.label.textContent = p ? p.name : this.opts.placeholder;
    this.label.classList.toggle('muted', !p);
  }

  _filtered() {
    const q = this.search.value.trim().toLowerCase();
    return q
      ? this.projects.filter((p) => p.name.toLowerCase().includes(q) ||
          (p.client || '').toLowerCase().includes(q))
      : this.projects;
  }

  _renderList() {
    const q = this.search.value.trim();
    const matches = this._filtered();
    this.rows = [];

    if (this.opts.allowClear && !q) {
      this.rows.push({ type: 'clear', label: 'No project' });
    }
    for (const p of matches) this.rows.push({ type: 'project', project: p, label: p.name });
    const exact = this.projects.some((p) => p.name.toLowerCase() === q.toLowerCase());
    if (q && !exact) this.rows.push({ type: 'create', label: q });
    if (!this.rows.length) this.rows.push({ type: 'empty', label: 'No projects yet' });

    this.highlight = Math.max(0, Math.min(this.highlight, this.rows.length - 1));
    this.list.innerHTML = '';
    this.rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'picker-row' + (i === this.highlight ? ' active' : '') +
        (row.type === 'empty' ? ' empty' : '');
      li.setAttribute('role', 'option');
      // Built as nodes rather than markup: project names, clients and colours can
      // come from an imported file, and must never be parsed as HTML.
      const span = (cls, text) => {
        const s = document.createElement('span');
        s.className = cls;
        if (text !== undefined) s.textContent = text;
        return s;
      };
      if (row.type === 'project') {
        const dot = span('dot');
        // Assigning the property (not the attribute) drops anything that isn't
        // a valid colour instead of letting it escape into markup.
        dot.style.background = safeColor(row.project.color);
        li.append(dot, span('name', row.project.name));
        if (row.project.client) li.append(span('client', row.project.client));
      } else if (row.type === 'create') {
        li.append(span('plus', '+'), span('name', `Create “${row.label}”`));
      } else {
        li.append(span('dot empty-dot'), span('name', row.label));
      }
      if (row.type !== 'empty') {
        li.addEventListener('mouseenter', () => {
          this.highlight = i;
          this.list.querySelectorAll('.picker-row').forEach((el, j) =>
            el.classList.toggle('active', j === i));
        });
        li.addEventListener('click', () => this._choose(row));
      }
      this.list.appendChild(li);
    });
  }

  _onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      this.highlight = (this.highlight + dir + this.rows.length) % this.rows.length;
      this._renderList();
      this.list.querySelector('.picker-row.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = this.rows[this.highlight];
      if (row) this._choose(row);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      this.btn.focus();
    }
  }

  async _choose(row) {
    if (row.type === 'empty') return;
    if (row.type === 'clear') this.value = null;
    else if (row.type === 'project') this.value = row.project.id;
    else if (row.type === 'create') {
      const created = await Store.addProject({ name: row.label });
      this.projects = await Store.getProjects();
      this.value = created.id;
    }
    this.close();
    this._renderButton();
    this.opts.onChange?.(this.value);
    this.btn.focus();
  }
}
