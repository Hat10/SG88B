import { useState } from 'react';
import { Tabs } from '../components';
import OppskrifterTab from './middag/OppskrifterTab';
import UkeplanTab from './middag/UkeplanTab';

type MiddagTab = 'ukeplan' | 'oppskrifter';

export default function PageMiddag() {
  const [tab, setTab] = useState<MiddagTab>('ukeplan');

  return (
    <div className="grid grid-12">
      <div className="col-12">
        <Tabs
          items={[
            { id: 'ukeplan', label: '📅 Ukeplan' },
            { id: 'oppskrifter', label: '📖 Oppskrifter' },
          ]}
          value={tab}
          onChange={id => setTab(id as MiddagTab)}
        />
      </div>
      <div className="col-12">
        {tab === 'ukeplan' && <UkeplanTab />}
        {tab === 'oppskrifter' && <OppskrifterTab />}
      </div>
    </div>
  );
}
