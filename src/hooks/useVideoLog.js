import { useEffect, useMemo, useState } from 'react';
import { useResource } from '../components/PluginPrimitives';
import { filterVideoInsights } from './video-log.mjs';

export function useVideoLog({ workspace, api, plugin }) {
  const resource = useResource(api, 'plugins.status', { workspaceId: workspace.id, id: 'video-log' }, { enabled: Boolean(plugin.enabled) });
  const [query, setQuery] = useState(''), [video, setVideo] = useState(''), [selection, setSelection] = useState(null);
  const sourcePath = plugin.config?.sourcePath || '';
  useEffect(() => { setSelection(null); resource.reload(); }, [sourcePath]);
  useEffect(() => { setSelection(null); }, [resource.data?.observedAt]);
  const document = resource.data?.available ? resource.data : { insights: [], origins: [] };
  const items = useMemo(() => filterVideoInsights(document, { query, video }), [resource.data, query, video]);
  const selected = items.find(item => item.id === selection) || null;
  const origin = document.origins.find(item => item.id === selected?.originId);
  const videos = [...new Set(document.origins.filter(item => item.kind === 'video').map(item => item.video))];
  const showVideo = value => { setVideo(value); setQuery(''); setSelection(null); };
  return { resource, document, items, videos, query, setQuery, video, setVideo, selected, origin, setSelection, showVideo };
}
