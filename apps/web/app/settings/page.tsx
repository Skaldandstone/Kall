'use client';

import { useEffect, useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import AppNav from '../components/AppNav';

const API='/api/kall';
type User={email:string;full_name:string;country?:string|null;state_region?:string|null;plan?:string};

export default function SettingsPage(){
  const[user,setUser]=useState<User|null>(null);
  const[message,setMessage]=useState('');
  const[confirmEmail,setConfirmEmail]=useState('');
  const[confirmingDelete,setConfirmingDelete]=useState(false);
  const[deleting,setDeleting]=useState(false);
  const[deleteError,setDeleteError]=useState('');
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
  async function handleDeleteAccount(){
    setDeleting(true);
    setDeleteError('');
    const response=await fetch(`${API}/me`,{
      method:'DELETE',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({confirm_email:confirmEmail}),
    });
    if(response.status===204){
      // Nothing left to be signed in as. Clerk's own session still exists
      // until it expires or the account deletion's best-effort call to
      // revoke it lands -- signing out here is what makes this browser stop
      // acting as if the account is still there right now.
      await signOut({redirectUrl:'/'});
      return;
    }
    setDeleting(false);
    setDeleteError(response.status===422?'That does not match your account email.':'Something went wrong. Please try again.');
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
      <a className='card' href='/settings/identity'><h2>Identity & contact</h2><p>Update your name, location, links, and professional summary.</p></a>
      <a className='card' href='/account'><h2>Sign-in & security</h2><p>Add passkeys, connect identity providers, and enable authenticator-app 2FA.</p></a>
      <a className='card' href='/profiles'><h2>Career profiles</h2><p>Manage target roles, industries, compensation, and work preferences.</p></a>
      <a className='card' href='/settings/career-page'><h2>Career page</h2><p>Build and publish the page you send instead of a resume.</p></a>
      <a className='card' href='/settings/notifications'><h2>Notifications</h2><p>Choose when Kall emails you the daily brief and new matches.</p></a>
      <a className='card' href='/privacy'><h2>Privacy controls</h2><p>Choose which profile fields Kall may use, share, or omit.</p></a>
      <a className='card' href='/billing'><h2>Plan & billing</h2><p>Review your subscription and payment options.</p></a>
    </section>
    <section className='card' style={{marginTop:24}}><h2>Session</h2><p>Sign out of this browser and return to the Kall home page.</p><button className='button secondary' onClick={handleSignOut}>Sign out</button></section>
    <section className='card' style={{marginTop:24,borderColor:'var(--danger)'}}>
      <h2>Delete account</h2>
      <p>Permanently deletes your account and everything in it: resumes, applications, generated documents, and your career page. This cannot be undone.</p>
      {!confirmingDelete
        ? <button className='button ghost' onClick={()=>setConfirmingDelete(true)}>Delete my account</button>
        : <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:12}}>
            <label style={{display:'flex',flexDirection:'column',gap:4}}>
              <span className='muted'>Type your email ({user?.email ?? '…'}) to confirm</span>
              <input className='input' value={confirmEmail} onChange={e=>setConfirmEmail(e.target.value)} placeholder={user?.email} />
            </label>
            {deleteError&&<p className='notice'>{deleteError}</p>}
            <div style={{display:'flex',gap:8}}>
              <button
                className='button danger'
                disabled={deleting||!user||confirmEmail.trim().toLowerCase()!==user.email.toLowerCase()}
                onClick={handleDeleteAccount}
              >{deleting?'Deleting…':'Permanently delete my account'}</button>
              <button className='button ghost' disabled={deleting} onClick={()=>{setConfirmingDelete(false);setConfirmEmail('');setDeleteError('');}}>Cancel</button>
            </div>
          </div>}
    </section>
  </main>
}
