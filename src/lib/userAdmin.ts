import { supabase } from './supabase';
import type { Role } from '../types';

interface CreateUserInput {
  name: string;
  email: string;
  phone?: string;
  role: Role;
  organisation_id?: string | null;
}

interface CreateUserResult {
  user_id: string;
  temp_password: string;
}

interface ResetPasswordResult {
  email: string;
  temp_password: string;
}

interface SendPasswordResetResult {
  email: string;
}

interface UpdateUserInput {
  user_id: string;
  name: string;
  email: string;
  phone?: string;
  active?: boolean;
}

interface UpdateUserResult {
  email: string;
}

async function callUserFunction<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Åtgärden kunde inte slutföras');
  }

  return result as T;
}

export function createUserAccount(input: CreateUserInput) {
  return callUserFunction<CreateUserResult>('create-user', input);
}

export function resetUserPassword(userId: string) {
  return callUserFunction<ResetPasswordResult>('admin-reset-password', { user_id: userId });
}

export function sendUserPasswordResetEmail(userId: string) {
  return callUserFunction<SendPasswordResetResult>('admin-send-password-reset', {
    user_id: userId,
    redirect_to: `${window.location.origin}/reset-password`,
  });
}

export function updateUserAccount(input: UpdateUserInput) {
  return callUserFunction<UpdateUserResult>('admin-update-user', input);
}
