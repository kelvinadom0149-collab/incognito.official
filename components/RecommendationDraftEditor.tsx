'use client';

import { useState } from 'react';

export default function RecommendationDraftEditor({ recommendationId, initial = '' }: { recommendationId: string; initial?: string }) {
  const [body, setBody] = useState(initial);
  const [status, setStatus] = useState('');

  async function save() {
    if (!body.toLowerCase().includes('reason to choose') || body.length < 80) {
      setStatus('Include a clear reason to choose and at least 80 characters.');
      return;
    }
    const token = localStorage.getItem('incognito_admin_token');
    const response = await fetch(`/api/admin/recommendations/${recommendationId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftBody: body }),
    });
    setStatus(response.ok ? 'Draft saved' : 'Unable to save draft');
  }

  return (
    <section className="field">
      <label>Human recommendation</label>
      <textarea className="editor" value={body} onChange={(event) => setBody(event.target.value)} />
      <button type="button" className="button" onClick={save}>Save Draft</button>
      <p role="status">{status}</p>
    </section>
  );
}
