import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MapPin {
  id: string;
  sourceType: 'rating' | 'bucket';
  sourceId: string;
  lat: number;
  lng: number;
}

interface MapCtx {
  pins: MapPin[];
  loading: boolean;
  setPin: (sourceType: 'rating' | 'bucket', sourceId: string, lat: number, lng: number) => Promise<void>;
  removePin: (sourceType: 'rating' | 'bucket', sourceId: string) => Promise<void>;
  getPin: (sourceType: 'rating' | 'bucket', sourceId: string) => MapPin | undefined;
  dismissedBuckets: Set<string>;
  dismissBucket: (id: string) => Promise<void>;
  restoreBucket: (id: string) => Promise<void>;
}

// ─── Context ────────────────────────────────────────────────────────────────

const Ctx = createContext<MapCtx | null>(null);

function rowToPin(r: Record<string, unknown>): MapPin {
  return {
    id: r.id as string,
    sourceType: r.source_type as 'rating' | 'bucket',
    sourceId: r.source_id as string,
    lat: r.lat as number,
    lng: r.lng as number,
  };
}

export function MapProvider({ children }: { children: React.ReactNode }) {
  const [pins, setPins] = useState<MapPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedBuckets, setDismissedBuckets] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.from('map_pins').select('*').then(({ data }) => {
      if (data) setPins(data.map(rowToPin));
      setLoading(false);
    });
    supabase.from('map_dismissed').select('source_id').eq('source_type', 'bucket').then(({ data }) => {
      if (data) setDismissedBuckets(new Set(data.map(r => r.source_id as string)));
    });

    const ch = supabase.channel('map_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'map_pins' }, () => {
        supabase.from('map_pins').select('*').then(({ data }) => {
          if (data) setPins(data.map(rowToPin));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'map_dismissed' }, () => {
        supabase.from('map_dismissed').select('source_id').eq('source_type', 'bucket').then(({ data }) => {
          if (data) setDismissedBuckets(new Set(data.map(r => r.source_id as string)));
        });
      })
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, []);

  const setPin = useCallback(async (
    sourceType: 'rating' | 'bucket',
    sourceId: string,
    lat: number,
    lng: number,
  ) => {
    setPins(prev => {
      const without = prev.filter(p => !(p.sourceType === sourceType && p.sourceId === sourceId));
      return [...without, { id: `${sourceType}:${sourceId}`, sourceType, sourceId, lat, lng }];
    });
    const { error } = await supabase.from('map_pins').upsert(
      { source_type: sourceType, source_id: sourceId, lat, lng },
      { onConflict: 'source_type,source_id' }
    );
    if (error) console.error('[MapContext] setPin error:', error);
  }, []);

  const removePin = useCallback(async (
    sourceType: 'rating' | 'bucket',
    sourceId: string,
  ) => {
    setPins(prev => prev.filter(p => !(p.sourceType === sourceType && p.sourceId === sourceId)));
    const { error } = await supabase.from('map_pins')
      .delete()
      .eq('source_type', sourceType)
      .eq('source_id', sourceId);
    if (error) console.error('[MapContext] removePin error:', error);
  }, []);

  const getPin = useCallback((sourceType: 'rating' | 'bucket', sourceId: string) => {
    return pins.find(p => p.sourceType === sourceType && p.sourceId === sourceId);
  }, [pins]);

  const dismissBucket = useCallback(async (id: string) => {
    setDismissedBuckets(prev => new Set(prev).add(id));
    await supabase.from('map_dismissed').upsert(
      { source_type: 'bucket', source_id: id },
      { onConflict: 'source_type,source_id' }
    );
  }, []);

  const restoreBucket = useCallback(async (id: string) => {
    setDismissedBuckets(prev => { const next = new Set(prev); next.delete(id); return next; });
    await supabase.from('map_dismissed')
      .delete()
      .eq('source_type', 'bucket')
      .eq('source_id', id);
  }, []);

  return (
    <Ctx.Provider value={{ pins, loading, setPin, removePin, getPin, dismissedBuckets, dismissBucket, restoreBucket }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMapPins() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMapPins must be used within MapProvider');
  return ctx;
}
