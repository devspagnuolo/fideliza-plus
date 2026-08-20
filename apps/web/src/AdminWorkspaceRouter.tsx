import { useEffect, useState } from 'react';
import { api } from './api';
import { AdvancedWorkspace as GenericWorkspace, NativeOperationalWorkspace, isNativeWorkspace } from './AdminAdvancedWorkspaces';

export function AdvancedWorkspace(props: { page: string; subpage: string; all: any }) {
  const [current, setCurrent] = useState(props.all);
  useEffect(() => setCurrent(props.all), [props.all]);
  const refresh = async () => setCurrent(await api('/platform/overview'));
  if (isNativeWorkspace(props.page, props.subpage)) {
    return <NativeOperationalWorkspace {...props} all={current} refresh={refresh} />;
  }
  return <GenericWorkspace {...props} all={current} />;
}
