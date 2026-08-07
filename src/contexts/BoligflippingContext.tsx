import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FlippingProject, FlippingCost } from '../data';

interface BoligflippingCtx {
  projects: FlippingProject[];
  costs: FlippingCost[];
  loading: boolean;
  createProject: (name: string, purchasePrice: number) => Promise<string>;
  updateProject: (id: string, updates: Partial<FlippingProject>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addCost: (projectId: string, category: string, description: string, amount: number, date: string) => Promise<void>;
  updateCost: (id: string, updates: Partial<FlippingCost>) => Promise<void>;
  deleteCost: (id: string) => Promise<void>;
}

const BoligflippingContext = createContext<BoligflippingCtx>({
  projects: [],
  costs: [],
  loading: true,
  createProject: async () => '',
  updateProject: async () => {},
  deleteProject: async () => {},
  addCost: async () => {},
  updateCost: async () => {},
  deleteCost: async () => {},
});

export function BoligflippingProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<FlippingProject[]>([]);
  const [costs, setCosts] = useState<FlippingCost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [projectsRes, costsRes] = await Promise.all([
        supabase.from('flipping_projects').select('*').order('created_at', { ascending: false }),
        supabase.from('flipping_costs').select('*').order('date', { ascending: false }),
      ]);

      if (projectsRes.data) setProjects(projectsRes.data);
      if (costsRes.data) setCosts(costsRes.data);
    } catch (err) {
      console.error('Error loading boligflipping data:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();

    const projectsChannel = supabase
      .channel('flipping_projects_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flipping_projects' }, () => loadData())
      .subscribe();

    const costsChannel = supabase
      .channel('flipping_costs_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flipping_costs' }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(projectsChannel);
      supabase.removeChannel(costsChannel);
    };
  }, []);

  const createProject = async (name: string, purchasePrice: number) => {
    const { data, error } = await supabase
      .from('flipping_projects')
      .insert([{
        project_name: name,
        purchase_price: purchasePrice,
        sale_price: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])
      .select();

    if (error) throw error;
    if (data && data.length > 0) {
      await loadData();
      return data[0].id;
    }
    return '';
  };

  const updateProject = async (id: string, updates: Partial<FlippingProject>) => {
    const { error } = await supabase
      .from('flipping_projects')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;
    await loadData();
  };

  const deleteProject = async (id: string) => {
    // Delete all costs first (cascade should handle this, but let's be explicit)
    await supabase.from('flipping_costs').delete().eq('project_id', id);
    // Then delete the project
    const { error } = await supabase
      .from('flipping_projects')
      .delete()
      .eq('id', id);

    if (error) throw error;
    await loadData();
  };

  const addCost = async (projectId: string, category: string, description: string, amount: number, date: string) => {
    const { error } = await supabase
      .from('flipping_costs')
      .insert([{
        project_id: projectId,
        category,
        description,
        amount,
        date,
        created_at: new Date().toISOString(),
      }]);

    if (error) throw error;
    await loadData();
  };

  const updateCost = async (id: string, updates: Partial<FlippingCost>) => {
    const { error } = await supabase
      .from('flipping_costs')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
    await loadData();
  };

  const deleteCost = async (id: string) => {
    const { error } = await supabase
      .from('flipping_costs')
      .delete()
      .eq('id', id);

    if (error) throw error;
    await loadData();
  };

  return (
    <BoligflippingContext.Provider value={{
      projects,
      costs,
      loading,
      createProject,
      updateProject,
      deleteProject,
      addCost,
      updateCost,
      deleteCost,
    }}>
      {children}
    </BoligflippingContext.Provider>
  );
}

export const useBoligflipping = () => useContext(BoligflippingContext);
