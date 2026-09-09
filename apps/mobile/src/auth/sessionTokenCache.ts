import { tokenCache as clerkTokenCache } from '@clerk/expo/token-cache';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY_INDEX = 'kall.clerk.token-keys';

async function tokenKeys(): Promise<string[]> {
  try {
    const value = await SecureStore.getItemAsync(TOKEN_KEY_INDEX);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

async function rememberTokenKey(key: string): Promise<void> {
  const keys = new Set(await tokenKeys());
  keys.add(key);
  await SecureStore.setItemAsync(TOKEN_KEY_INDEX, JSON.stringify([...keys]));
}

async function forgetTokenKey(key: string): Promise<void> {
  const keys = (await tokenKeys()).filter((item) => item !== key);
  if (keys.length > 0) {
    await SecureStore.setItemAsync(TOKEN_KEY_INDEX, JSON.stringify(keys));
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY_INDEX);
  }
}

export const sessionTokenCache = clerkTokenCache
  ? {
      getToken: (key: string) => clerkTokenCache!.getToken(key),
      saveToken: async (key: string, token: string) => {
        await clerkTokenCache!.saveToken(key, token);
        await rememberTokenKey(key);
      },
      clearToken: async (key: string) => {
        await clerkTokenCache!.clearToken?.(key);
        await forgetTokenKey(key);
      },
    }
  : undefined;

export async function clearSessionTokenCache(): Promise<void> {
  if (!clerkTokenCache) return;
  const cache = clerkTokenCache;
  const keys = await tokenKeys();
  await Promise.all(keys.map((key) => cache.clearToken?.(key)));
  await SecureStore.deleteItemAsync(TOKEN_KEY_INDEX);
}
