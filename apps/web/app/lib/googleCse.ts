// Shared loader for Google's Programmable Search Engine widget script, used
// by every embedded search results component (jobs, growth resources, ...).
// A single global script/promise avoids a race if more than one widget ends
// up mounted on the same page.
const SCRIPT_ID = 'kall-google-cse-script';

export type SearchElement = { execute: (query: string) => void; clearAllResults?: () => void };
export type GoogleCseApi = {
  render: (config: { div: HTMLElement; tag: 'searchresults-only'; gname: string; attributes: Record<string, string | boolean> }) => void;
  getElement: (gname: string) => SearchElement | null;
};

declare global {
  interface Window {
    __gcse?: { parsetags: 'explicit' };
    google?: { search?: { cse?: { element?: GoogleCseApi } } };
    __kallGoogleCsePromise?: Promise<void>;
  }
}

export function loadGoogleCse(cseId: string): Promise<void> {
  if (window.google?.search?.cse?.element) return Promise.resolve();
  if (window.__kallGoogleCsePromise) return window.__kallGoogleCsePromise;
  window.__gcse = { parsetags: 'explicit' };
  window.__kallGoogleCsePromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const finish = () => {
      let attempts = 0;
      const waitForApi = window.setInterval(() => {
        attempts += 1;
        if (window.google?.search?.cse?.element) {
          window.clearInterval(waitForApi);
          resolve();
        } else if (attempts > 100) {
          window.clearInterval(waitForApi);
          reject(new Error('Google search did not finish loading.'));
        }
      }, 50);
    };
    if (existing) {
      finish();
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://cse.google.com/cse.js?cx=${cseId}`;
    script.onload = finish;
    script.onerror = () => reject(new Error('Google search could not be loaded.'));
    document.head.appendChild(script);
  });
  return window.__kallGoogleCsePromise;
}
