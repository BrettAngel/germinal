// PROTOTYPE (variant B branch) — lineage depth for saves.
// Every save on this branch merges into the theme's live canvas, so a save
// with no share-link parent builds on the live canvas: its parent is the most
// recent save for that (namespaced) theme, depth = that save's depth + 1.
// A share-link save keeps its explicit parent (depth = parent depth + 1).
// The first save of an empty theme has no parent, depth 0.
//   lookupById(id)        → { short_id, depth } | null
//   lookupLatest(theme)   → { short_id, depth } | null   (latest canvas_states row)
export async function resolveLineage({ parentId, theme, lookupById, lookupLatest }){
  if(parentId){
    const p = await lookupById(parentId);
    return p ? { parentId, depth: (p.depth | 0) + 1, via: 'share' } : { parentId, depth: 0, via: 'share-missing' };
  }
  const l = await lookupLatest(theme);
  return l ? { parentId: l.short_id, depth: (l.depth | 0) + 1, via: 'live' } : { parentId: null, depth: 0, via: 'first' };
}
