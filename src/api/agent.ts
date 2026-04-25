import { getApiUrl } from './config';

export interface AgentRuntimeProfile {
  source_agent?: string;
  archetype?: string;
  role?: string;
  goal?: string;
  backstory?: string;
  system_prompt?: string;
  llm_model?: string;
  temperature?: number;
  stream_enabled?: boolean;
  memory_enabled?: boolean;
  skill_ids?: string[];
  mcp_config_ids?: number[];
  execution_mode?: string;
  max_iterations?: number;
  plan_prompt?: string;
  approval_mode?: string;
}

export interface Agent {
  id: number;
  name: string;
  description: string;
  category: string;
  is_builtin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  runtime_profile?: AgentRuntimeProfile;
}

export const listAgents = async (): Promise<Agent[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/agents`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data || [];
};

export const getAgent = async (id: number): Promise<Agent | null> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/agents/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    return null;
  }
  const json = await response.json();
  return json.data || null;
};

export const updateAgent = async (
  id: number,
  data: {
    name?: string;
    description?: string;
    category?: string;
    runtime_profile?: Partial<AgentRuntimeProfile>;
  },
): Promise<Agent | null> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/agents/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    return null;
  }
  const json = await response.json();
  return json.data || null;
};