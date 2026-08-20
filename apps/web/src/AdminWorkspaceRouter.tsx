import { useEffect, useState } from 'react';
import { api } from './api';
import { AdvancedWorkspace as GenericWorkspace, NativeOperationalWorkspace, isNativeWorkspace } from './AdminAdvancedWorkspaces';
import { AdminSystemWorkspace, isSystemWorkspace } from './AdminSystemWorkspaces';

export function AdvancedWorkspace(props: { page: string; subpage: string; all: any }) {
  const [current, setCurrent] = useState(props.all);
  useEffect(() => setCurrent(props.all), [props.all]);
  const refresh = async () => setCurrent(await api('/platform/overview'));
  if (isSystemWorkspace(props.page, props.subpage)) {
    return <AdminSystemWorkspace page={props.page} subpage={props.subpage} />;
  }
  if (isNativeWorkspace(props.page, props.subpage)) {
    return <NativeOperationalWorkspace {...props} all={current} refresh={refresh} />;
  }
  return <GenericWorkspace {...props} all={current} />;
}
