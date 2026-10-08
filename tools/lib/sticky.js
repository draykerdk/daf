'use strict';
/**
 * sticky — choose which tally comment on a pull request to keep.
 *
 * The "Federation tally" workflow keeps one comment per pull request, marked by
 * a hidden HTML comment on its first line. Given every comment on the pull
 * request (as `gh api --paginate --slurp` returns them) and that marker, this
 * says which existing comment to update and which duplicates to remove. Only
 * comments written by the Actions bot are ever chosen: a person's comment that
 * happens to start with the marker is never edited or deleted.
 *
 * Pure: no network, no files.
 */

const BOT_LOGIN = 'github-actions[bot]';

/** Accept a flat array of comments or an array of pages. */
function flatten(data) {
  if (!Array.isArray(data)) throw new Error('expected a JSON array of comments, or an array of pages');
  const out = [];
  for (const x of data) {
    if (Array.isArray(x)) out.push(...x);
    else out.push(x);
  }
  return out;
}

const isId = (v) => Number.isSafeInteger(v) && v > 0;

/** True when the comment is one of ours. */
function isOurs(c, marker) {
  return !!c && typeof c === 'object' &&
    isId(c.id) &&
    !!c.user && c.user.login === BOT_LOGIN && c.user.type === 'Bot' &&
    typeof c.body === 'string' && c.body.startsWith(marker);
}

/**
 * selectSticky(comments, marker) -> { patch: id | null, delete: [ids] }.
 * The oldest of our comments is kept and updated; every other one is removed.
 * No comment of ours -> { patch: null, delete: [] }, which means "post one".
 */
function selectSticky(comments, marker) {
  if (typeof marker !== 'string' || !marker.trim()) throw new Error('a non-empty marker is required');
  const ours = flatten(comments).filter((c) => isOurs(c, marker));
  const time = (c) => {
    const t = Date.parse(c.created_at);
    return Number.isNaN(t) ? Infinity : t;
  };
  ours.sort((a, b) => time(a) - time(b) || a.id - b.id);
  if (!ours.length) return { patch: null, delete: [] };
  const seen = new Set([ours[0].id]);
  const extra = [];
  for (const c of ours.slice(1)) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    extra.push(c.id);
  }
  return { patch: ours[0].id, delete: extra };
}

module.exports = { selectSticky, isOurs, BOT_LOGIN };
