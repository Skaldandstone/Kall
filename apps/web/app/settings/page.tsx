'use client';

import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';

const API='/api/kall';
type User={email:string;full_name:string;country?:string|null;state_region?:string|null;plan?:string};

export default function SettingsPage(){
  const[user,setUser]=useState<User|null>(null);
  const[message,setMessage]=useState('');
  useEffect(()=>{
    const token=localStorage.getItem('kall_token');
    if(!token){window.location.replace('/login');return;}
    fetch(`${API}/me`,{headers:{Authorization:`Bearer ${token}`}})
      .then(async response=>{
        if(response.status===401){localStorage.removeItem('kall_token');window.location.replace('/login');return null;}
        if(!response.ok)throw new Error('Unable to load account settings.');
        return response.json();
      })
      .then(data=>{if(data)setUser(data)})
      .catch(error=>setMessage(error instanceof Error?error.message:'Unable to load account settings.'));
  },[]);
  async function signOut(){
    const token=localStorage.getItem('kall_token');
    if(token)await fetch(`${API}/auth/logout`,{method:'POST',headers:{Authorization:`Bearer ${token}`}}).catch(()=>undefined);
    localStorage.removeItem('kall_token');
    window.location.replace('/login');
  }
  return <main className='shell'>
    <AppNav />
    <section className='hero' style={{paddingTop:32,paddingBottom:36}}>
      <span className='eyebrow'>Account settings</span>
      <h1 style={{fontSize:'clamp(42px, 7vw, 72px)'}}>Manage your Kall account.</h1>
      <p>Update your identity, security, career preferences, privacy controls, and subscription.</p>
    </section>
    {message&&<p className='notice'>{message}</p>}
    {user&&<section className='card' style={{marginBottom:24}}><h2>{user.full_name}</h2><p>{user.email}</p><p className='muted'>{[user.state_region,user.country].filter(Boolean).join(', ')||'Location not set'} · {String(user.plan||'free').replaceAll('_',' ')} plan</p></section>}
    <section className='grid' style={{gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))'}}>
      <a className='card' href='/profiles?tab=identity'><h2>Identity & contact</h2><p>Update your name, location, links, and professional summary.</p></a>
      <a className='card' href='/security-setup'><h2>Sign-in & security</h2><p>Add passkeys, connect identity providers, and enable authenticator-app 2FA.</p></a>
      <a className='card' href='/profiles'><h2>Career profiles</h2><p>Manage target roles, industries, compensation, and work preferences.</p></a>
      <a className='card' href='/privacy'><h2>Privacy controls</h2><p>Choose which profile fields Kall may use, share, or omit.</p></a>
      <a className='card' href='/billing'><h2>Plan & billing</h2><p>Review your subscription and payment options.</p></a>
    </section>
    <section className='card' style={{marginTop:24}}><h2>Session</h2><p>Sign out of this browser and return to the login page.</p><button className='button secondary' onClick={signOut}>Sign out</button></section>
  </main>
}
