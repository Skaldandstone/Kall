'use client';

import { useEffect, useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import AppNav from '../components/AppNav';

const API='/api/kall';
type User={email:string;full_name:string;country?:string|null;state_region?:string|null;plan?:string};

export default function SettingsPage(){
  const[user,setUser]=useState<User|null>(null);
  const[message,setMessage]=useState('');
  const{signOut}=useClerk();
  useEffect(()=>{
    fetch(`${API}/me`)
      .then(async response=>{
        if(response.status===401){window.location.replace('/sign-in');return null;}
        if(!response.ok)throw new Error('Unable to load account settings.');
        return response.json();
      })
      .then(data=>{if(data)setUser(data)})
      .catch(error=>setMessage(error instanceof Error?error.message:'Unable to load account settings.'));
  },[]);
  // Clerk revokes the session server-side and clears its cookie; there is no
  // local token to discard any more.
  async function handleSignOut(){
    await signOut({redirectUrl:'/'});
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
      <a className='card' href='/account'><h2>Sign-in & security</h2><p>Add passkeys, connect identity providers, and enable authenticator-app 2FA.</p></a>
      <a className='card' href='/profiles'><h2>Career profiles</h2><p>Manage target roles, industries, compensation, and work preferences.</p></a>
      <a className='card' href='/privacy'><h2>Privacy controls</h2><p>Choose which profile fields Kall may use, share, or omit.</p></a>
      <a className='card' href='/billing'><h2>Plan & billing</h2><p>Review your subscription and payment options.</p></a>
    </section>
    <section className='card' style={{marginTop:24}}><h2>Session</h2><p>Sign out of this browser and return to the Kall home page.</p><button className='button secondary' onClick={handleSignOut}>Sign out</button></section>
  </main>
}
