/**
 * What to suggest while typing a description or tags: the values used in recent
 * entries, newest first. Pure functions over the entry list — no storage, no DOM.
 */

export const SUGGESTION_LIMIT = 6;

const newestFirst = (entries) => entries.slice().sort((a, b) => b.start - a.start);

/** Values that start with the query come before ones that only contain it. */
function rank(values, query, textOf) {
  const q = query.trim().toLowerCase();
  if (!q) return values;
  const matches = values.filter((v) => textOf(v).toLowerCase().includes(q));
  return [
    ...matches.filter((v) => textOf(v).toLowerCase().startsWith(q)),
    ...matches.filter((v) => !textOf(v).toLowerCase().startsWith(q)),
  ];
}

/**
 * Recent descriptions matching `query`, each with the project it was last used
 * with. A description identical to what is already typed is left out.
 *
 * @returns {Array<{ description: string, projectId: string|null }>}
 */
export function recentDescriptions(entries, query = '', { limit = SUGGESTION_LIMIT } = {}) {
  const seen = new Set();
  const unique = [];
  for (const e of newestFirst(entries)) {
    const description = String(e.description || '').trim();
    const key = description.toLowerCase();
    if (!description || seen.has(key)) continue;
    seen.add(key);
    unique.push({ description, projectId: e.projectId ?? null });
  }
  return rank(unique, query, (d) => d.description)
    .filter((d) => d.description !== query.trim())
    .slice(0, limit);
}

/** Like recentDescriptions, shaped as rows for the suggestion list. */
export function descriptionRows(entries, projects, query, opts) {
  return recentDescriptions(entries, query, opts).map((d) => {
    const project = d.projectId ? projects.get(d.projectId) : null;
    const usable = project && !project.archived;
    return {
      label: d.description,
      hint: usable ? project.name : '',
      color: usable ? project.color : null,
      projectId: usable ? project.id : null,
    };
  });
}

/** The tag being typed: the part after the last comma. */
export function tagToken(text) {
  return String(text || '').split(',').pop().trim();
}

/**
 * Recent tags matching the tag being typed in a "comma, separated" field. Tags
 * already in the field are left out.
 *
 * @returns {string[]}
 */
export function recentTags(entries, text = '', { limit = SUGGESTION_LIMIT } = {}) {
  const parts = String(text || '').split(',').map((t) => t.trim().toLowerCase());
  const token = parts.pop();
  const seen = new Set(parts);
  const unique = [];
  for (const e of newestFirst(entries)) {
    for (const raw of e.tags || []) {
      const tag = String(raw).trim();
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      unique.push(tag);
    }
  }
  return rank(unique, token, (t) => t).filter((t) => t !== token).slice(0, limit);
}

/** Replaces the tag being typed with `tag`, ready for the next one. */
export function applyTag(text, tag) {
  const done = String(text || '').split(',').slice(0, -1).map((t) => t.trim()).filter(Boolean);
  return [...done, tag].join(', ') + ', ';
}
