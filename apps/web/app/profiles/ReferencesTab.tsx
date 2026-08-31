'use client';

import { FormEvent, useEffect, useState } from 'react';

const API = '/api/kall';

type Testimonial = {
  id: number;
  author_name: string;
  author_title?: string;
  author_company?: string;
  relationship: string;
  body: string;
  status: string;
  permission_granted: boolean;
  include_on_profile: boolean;
  include_in_applications: boolean;
};

export default function ReferencesTab() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [message, setMessage] = useState('');
  const [invite, setInvite] = useState('');


  async function load() {
    const response = await fetch(`${API}/testimonials`);
    if (response.ok) setItems(await response.json());
  }

  useEffect(() => { void load(); }, []);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`${API}/testimonials/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_name: form.get('name'),
        recipient_email: form.get('email'),
        relationship: form.get('relationship'),
        request_type: form.get('request_type'),
        personal_message: form.get('message'),
      }),
    });
    if (!response.ok) { setMessage('Unable to create the request.'); return; }
    const data = await response.json();
    setInvite(`${window.location.origin}/testimonial-submit?token=${data.invitation_token}`);
    setMessage('Invitation created. Copy the secure link and send it to your former coworker.');
    formElement.reset();
  }

  async function moderate(item: Testimonial, profile: boolean, applications: boolean) {
    const response = await fetch(`${API}/testimonials/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', include_on_profile: profile, include_in_applications: applications }),
    });
    setMessage(response.ok ? 'Visibility updated.' : 'Author permission is required before publishing.');
    if (response.ok) void load();
  }

  return (
    <>
      <section className="card">
        <h2>Request a testimonial or reference</h2>
        <form className="form" onSubmit={request}>
          <label><span className="muted">Coworker name</span><input className="input" name="name" required /></label>
          <label><span className="muted">Email address</span><input className="input" name="email" type="email" required /></label>
          <label><span className="muted">Relationship</span><input className="input" name="relationship" placeholder="Former manager" required /></label>
          <label><span className="muted">Request type</span><select className="input" name="request_type"><option value="testimonial">Written testimonial</option><option value="reference">Reference availability</option><option value="both">Both</option></select></label>
          <label><span className="muted">Personal note (optional)</span><textarea className="input" name="message" /></label>
          <button className="button" type="submit">Create invitation</button>
        </form>
        {invite && <div className="notice" style={{ marginTop: 16, wordBreak: 'break-all' }}>{invite}</div>}
        <p className="notice">{message}</p>
      </section>

      <section className="stack" style={{ marginTop: 18 }}>
        {items.map((item) => <article className="card" key={item.id}>
          <span className="pill">{item.status}</span>
          <blockquote style={{ fontSize: 20, lineHeight: 1.6, margin: '18px 0' }}>&ldquo;{item.body}&rdquo;</blockquote>
          <p><strong>{item.author_name}</strong>{item.author_title ? `, ${item.author_title}` : ''}{item.author_company ? ` at ${item.author_company}` : ''}</p>
          <p className="notice">{item.relationship} · {item.permission_granted ? 'Permission granted' : 'Permission pending'}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            <button className="button secondary" type="button" onClick={() => moderate(item, true, item.include_in_applications)}>Show on profile card</button>
            <button className="button secondary" type="button" onClick={() => moderate(item, item.include_on_profile, true)}>Allow in applications</button>
            <button className="button ghost" type="button" onClick={() => moderate(item, false, false)}>Keep private</button>
          </div>
        </article>)}
        {!items.length && <section className="card"><p>No testimonials yet. Create an invitation to begin.</p></section>}
      </section>
    </>
  );
}
