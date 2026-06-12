// netlify/functions/display-live.js
// Returns the current mother display canvas state
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30', // cache 30 seconds
  };

  const theme = event.queryStringParameters?.theme || 'love';

  try {
    const { data, error } = await supabase
      .from('mother_display')
      .select('*')
      .eq('theme', theme)
      .single();

    if (error || !data) {
      return { statusCode: 404, headers,
        body: JSON.stringify({ error: 'No display data yet' }) };
    }

    return { statusCode: 200, headers,
      body: JSON.stringify({
        theme: data.theme,
        generation: data.generation,
        cellData: data.cell_data,
        contributorCount: data.contributor_count,
        lastUpdated: data.updated_at,
      })
    };
  } catch(err) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: err.message }) };
  }
};
