// netlify/functions/canvas-load.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const shareId = event.path.split('/').pop();
  if (!shareId) return { statusCode: 400, headers,
    body: JSON.stringify({ error: 'No share ID' }) };

  try {
    const { data, error } = await supabase
      .from('canvas_states')
      .select('*')
      .eq('short_id', shareId)
      .single();

    if (error || !data) return { statusCode: 404, headers,
      body: JSON.stringify({ error: 'Canvas not found' }) };

    // Increment view count
    supabase.from('canvas_states')
      .update({ view_count: (data.view_count || 0) + 1 })
      .eq('short_id', shareId);

    return { statusCode: 200, headers,
      body: JSON.stringify({
        shareId,
        theme: data.theme,
        generation: data.generation,
        depth: data.depth,
        cellData: data.cell_data,
        stabMap: data.stab_map,
        parentId: data.parent_id,
        createdAt: data.created_at,
        contributorCount: data.view_count || 0,
      })
    };
  } catch(err) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: err.message }) };
  }
};
