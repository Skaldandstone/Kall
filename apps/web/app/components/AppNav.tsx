'use client';

import { useEffect, useState } from 'react';
import KallMark from './KallMark';
import styles from './AppNav.module.css';

type AppNavProps={current?:'brief'|'opportunities'|'applications'|'documents'|'career'};
type User={full_name?:string;email?:string};
const items=[['brief','Brief','/morning-brief'],['opportunities','Opportunities','/search'],['applications','Applications','/applications'],['documents','Documents','/resumes'],['career','Career','/profiles']] as const;

function initialsFor(user:User|null){
  const source=(user?.full_name||user?.email||'Account').trim();
  const words=source.split(/\s+/).filter(Boolean);
  if(words.length>=2)return `${words[0][0]}${words[words.length-1][0]}`.toUpperCase();
  return source.slice(0,2).toUpperCase();
}

export default function AppNav({current}:AppNavProps){
  const[user,setUser]=useState<User|null>(null);
  useEffect(()=>{
    fetch('/api/kall/me')
      .then(response=>response.ok?response.json():null)
      .then(data=>{if(data)setUser(data)})
      .catch(()=>undefined);
  },[]);
  return <header className={styles.header}><a className={styles.brand} href='/' aria-label='Kall home'><KallMark />Kall</a><nav className={styles.nav} aria-label='Primary navigation'>{items.map(([key,label,href])=><a key={key} href={href} className={`${styles.link} ${current===key?styles.active:''}`} aria-current={current===key?'page':undefined}>{label}</a>)}</nav><a className={styles.account} href='/settings' aria-label='Open account settings'>{initialsFor(user)}</a></header>
}
