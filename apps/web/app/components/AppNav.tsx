'use client';

import { useEffect, useState } from 'react';
import KallMark from './KallMark';
import styles from './AppNav.module.css';

type AppNavProps={current?:'brief'|'opportunities'|'applications'|'documents'|'career'|'portfolio'|'support'};
type User={full_name?:string;email?:string;is_admin?:boolean};
const items=[['brief','Brief','/morning-brief'],['opportunities','Opportunities','/search'],['applications','Applications','/applications'],['documents','Documents','/resumes'],['career','Career','/profiles'],['portfolio','Portfolio','/settings/career-page']] as const;

function initialsFor(user:User|null){
  const source=(user?.full_name||user?.email||'Account').trim();
  const words=source.split(/\s+/).filter(Boolean);
  if(words.length>=2)return `${words[0][0]}${words[words.length-1][0]}`.toUpperCase();
  return source.slice(0,2).toUpperCase();
}

export default function AppNav({current}:AppNavProps){
  const[user,setUser]=useState<User|null>(null);
  // The server decides this. Drawing the link is all it controls -- every
  // /admin route re-checks, so a forged flag buys a link to a 404.
  const admin=user?.is_admin===true;
  useEffect(()=>{
    fetch('/api/kall/me')
      .then(response=>response.ok?response.json():null)
      .then(data=>{if(data)setUser(data)})
      .catch(()=>undefined);
  },[]);
  return <>
    <a className="workspace-skip" href="#workspace-content">Skip to page content</a>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Kall home"><KallMark size={30} />Kall<span className={styles.tm}>™</span></a>
      <nav className={styles.nav} aria-label="Primary navigation">
        {items.map(([key,label,href]) => <a key={key} href={href}
          className={`${styles.link} ${current===key?styles.active:''}`}
          aria-current={current===key?'page':undefined}>{label}</a>)}
        {admin && <a href="/admin" className={`${styles.link} ${current==='support'?styles.active:''}`}
          aria-current={current==='support'?'page':undefined}>Support</a>}
      </nav>
      <a className={styles.account} href="/settings" aria-label="Open account settings">{initialsFor(user)}</a>
    </header>
    <div id="workspace-content" className="workspace-start" tabIndex={-1} />
  </>;
}
