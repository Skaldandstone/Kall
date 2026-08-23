import { apiRequest, setToken } from './client';

export type AuthResponse = {
  user_id: number;
  access_token: string;
  token_type: string;
};

export async function login(email: string, password: string): Promise<void> {
  const response = await apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  await setToken(response.access_token);
}

export async function register(fullName: string, email: string, password: string): Promise<void> {
  const response = await apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: { full_name: fullName, email, password },
    auth: false,
  });
  await setToken(response.access_token);
}
