import { getApiUrl } from './config';

export interface Skill {
  id: number;
  key: string;
  name: string;
  description: string;
  source_ref: string;
  category: string;
  risk_level: string;
  execution_mode: string;
  prompt_hint?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export const getSkills = async (): Promise<Skill[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/skills`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch skills');
  }
  const json = await response.json();
  return json.data || [];
};