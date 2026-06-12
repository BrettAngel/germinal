// netlify/functions/canvas-save.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

async function mergeIntoMother(theme, cellData) {
  try {
    const { data: mother } = await supabase
      .from('mother_display').select('*').eq('theme', theme).single();
    if (!mother) {
      await supabase.from('mother_display').insert({
        theme, generation: 1, cell_data: cellData, contributor_count: 1
      });
    } else {
      await supabase.from('mother_display').update({
        contributor_count: mother.contributor_count + 1,
        generation: mother.generation + 1,
        updated_at: new Date().toISOString()
      }).eq('theme', theme);
    }
  } catch(e) { console.error('Mother merge:', e); }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { theme='love', generation=1, parentId=null,
            cellData, stabMap, contributorId } = JSON.parse(event.body);

    if (!cellData) return { statusCode: 400, headers,
      body: JSON.stringify({ error: 'Missing cellData' }) };

    let depth = 0;
    if (parentId) {
      const { data: p } = await supabase.from('canvas_states')
        .select('depth').eq('short_id', parentId).single();
      if (p) depth = p.depth + 1;
    }

    let id, attempts = 0;
    while (attempts++ < 10) {
      id = shortId();
      const { data: ex } = await supabase.from('canvas_states')
        .select('short_id').eq('short_id', id).single();
      if (!ex) break;
    }

    const { error } = await supabase.from('canvas_states').insert({
      short_id: id, theme, generation,
      parent_id: parentId || null, depth,
      cell_data: cellData, stab_map: stabMap || null,
      contributor_id: contributorId || 'anonymous'
    });
    if (error) throw error;

    mergeIntoMother(theme, cellData);

    return { statusCode: 200, headers,
      body: JSON.stringify({
        shareId: id,
        shareUrl: `https://germinal.studio/c/${id}`,
        depth
      })
    };
  } catch(err) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: err.message }) };
  }
};
