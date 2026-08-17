const OPENAI_BASE = 'https://api.openai.com/v1';

export function requireKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY が Vercel に設定されていません。');
  return key;
}

export async function openaiJson(path, body) {
  const key = requireKey();
  const res = await fetch(`${OPENAI_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI API error: ${res.status}`);
  return data;
}

export async function uploadOpenAIFile(buffer, filename, mimeType) {
  const key = requireKey();
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename);
  const res = await fetch(`${OPENAI_BASE}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI file upload error: ${res.status}`);
  return data;
}

export function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}
