'use client';

import { FormEvent, useState } from 'react';
import KallMark from '../components/KallMark';

const API = '/api/kall';

export default function TestimonialSubmitPage() {
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const token = new URLSearchParams(window.location.search).get('token') || '';
    const response = await fetch(`${API}/testimonials/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        author_name: form.get('author_name'),
        author_title: form.get('author_title'),
        author_company: form.get('author_company'),
        relationship: form.get('relationship'),
        body: form.get('body'),
        permission_granted: form.get('permission_granted') === 'on',
      }),
    });
    setMessage(response.ok ? 'Thank you. Your response was submitted for review.' : 'This invitation is invalid, expired, or already completed.');
    if (response.ok) formElement.reset();
  }

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/"><KallMark />Kall</a></header>
    <section className="hero" style={{ paddingTop: 20, paddingBottom: 36 }}><span className="eyebrow">Private invitation</span><h1 style={{ fontSize: 'clamp(42px, 7vw, 72px)' }}>Share what it was like to work together.</h1><p>Your response is sent to the person who invited you. They cannot publish or attach it to an application unless you grant permission.</p></section>
    <section className="card">
      <form className="form" onSubmit={submit}>
        <input className="input" name="author_name" placeholder="Your name" required />
        <input className="input" name="author_title" placeholder="Your title" />
        <input className="input" name="author_company" placeholder="Company or organization" />
        <input className="input" name="relationship" placeholder="How you worked together" required />
        <textarea className="input" name="body" placeholder="Your testimonial or reference comments" required rows={8} />
        <label><input type="checkbox" name="permission_granted" /> I permit this response to be shown on a Kall profile or included with applications after the recipient approves it.</label>
        <button className="button">Submit response</button>
      </form>
      <p className="notice">{message}</p>
    </section>
  </main>;
}
