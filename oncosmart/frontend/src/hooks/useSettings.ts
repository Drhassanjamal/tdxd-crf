import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import type { Settings } from '../types';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: Settings; rows?: any[]; demoMode: boolean; messagingProvider: string }>('/settings'),
    staleTime: 60_000,
  });
}

export function usePhysicians() {
  return useQuery({ queryKey: ['physicians'], queryFn: () => api.get<{ id: string; full_name: string; full_name_ar: string | null }[]>('/users/physicians'), staleTime: 300_000 });
}

export function useChairs(date?: string) {
  return useQuery({ queryKey: ['chairs', date ?? 'today'], queryFn: () => api.get<any[]>(`/chairs${date ? `?date=${date}` : ''}`) });
}

export function useProtocols() {
  return useQuery({ queryKey: ['protocols'], queryFn: () => api.get<any[]>('/protocols'), staleTime: 60_000 });
}
