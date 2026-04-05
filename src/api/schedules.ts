import { getApiUrl } from './config';
import type { Schedule, CreateScheduleRequest, UpdateScheduleRequest, ScheduleExecution } from '../types';

export const listSchedules = async (): Promise<Schedule[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/schedules`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data || [];
};

export const getSchedule = async (id: number): Promise<Schedule> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/schedules/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data;
};

export const createSchedule = async (data: CreateScheduleRequest): Promise<Schedule> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/schedules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  return json.data;
};

export const updateSchedule = async (id: number, data: UpdateScheduleRequest): Promise<Schedule> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/schedules/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  return json.data;
};

export const deleteSchedule = async (id: number): Promise<void> => {
  const apiUrl = await getApiUrl();
  await fetch(`${apiUrl}/schedules/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
};

export const triggerSchedule = async (id: number): Promise<void> => {
  const apiUrl = await getApiUrl();
  await fetch(`${apiUrl}/schedules/${id}/trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
};

export const listScheduleExecutions = async (id: number, limit = 50): Promise<ScheduleExecution[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/schedules/${id}/executions?limit=${limit}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data || [];
};
