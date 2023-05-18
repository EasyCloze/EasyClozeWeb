import { useEffect, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import { localJson } from './utility/local';
import { useLocalStateJson } from './utility/localState';
import { useRefGetSet } from './utility/refGetSet';
import { useRefObj } from './utility/refObj';
import { generate_local_id, key_remote, key_local } from './utility/id';
import API from './utility/api';
import Text from './lang/Text';
import IconButton from './widget/IconButton';
import Message from './widget/Message';
import Placeholder from './widget/Placeholder';
import PositionAbsolute from './widget/PositionAbsolute';
import PositionSticky from './widget/PositionSticky';
import Item from './Item';
import './List.css';

const max_list_length = 10;
const op_delay_interval = 1 * 60 * 1000;
const idle_sync_period = 10 * 60 * 1000;
const min_sync_interval = 15 * 1000;

export default function List({ token, setToken, getMenuRef, setListRef }) {
  const [list, setList] = useLocalStateJson('list', []);
  const [getErrorRef, setErrorRef] = useRefGetSet();
  const item_map = useRefObj(() => new Map());
  const sync_state = useRefObj(() => {
    return {
      manager: null,
      enabled: false,
      next: 0,
    }
  });

  sync_state.manager = (function () {
    function enable() {
      if (sync_state.enabled) {
        return;
      }
      sync_state.enabled = true;
      sync_state.next = 0;
      prepare_sync();
    }

    function disable() {
      sync_state.enabled = false;
    }

    async function do_sync() {
      if (!token) {
        disable();
        return;
      }
      if (Date.now() < getMenuRef().time + min_sync_interval) {
        getErrorRef().setError('list.error.limit.sync.message');
        return;
      }
      if (getMenuRef().syncing) {
        return;
      }
      getMenuRef().setSyncing(true);
      await sync();
      getMenuRef().setSyncing(false);
    }

    async function prepare_sync() {
      if (!sync_state.enabled) {
        return;
      }
      if (Date.now() >= sync_state.next) {
        sync_state.next = Date.now() + idle_sync_period;
        await do_sync();
      }
      setTimeout(sync_state.manager.prepare_sync, Math.min(sync_state.next - Date.now(), op_delay_interval));
    }

    function op() {
      if (sync_state.enabled) {
        sync_state.next = Date.now() + op_delay_interval;
      }
    }

    return {
      enable,
      disable,
      do_sync,
      prepare_sync,
      op
    }
  })();

  setListRef({
    sync: sync_state.manager.do_sync
  });

  async function fetch_sync(token, body) {
    try {
      const response = await fetch(API('/item/sync'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body),
      });
      if (response.status !== 200) {
        switch (response.status) {
          case 404: setToken(null); break;
          case 429: getErrorRef().setError('list.error.limit.sync.message'); break;
          default: throw new Error();
        }
        return null;
      } else {
        getErrorRef().setError(null);
        return await response.json();
      }
    } catch (error) {
      getMenuRef().onSync(false);
      return null;
    }
  }

  async function sync() {
    let local = [];

    list.slice(0, max_list_length).forEach(id => {
      const item = item_map.get(id).sync();
      if (item) {
        local.push(item);
      }
    });

    const remote = await fetch_sync(token, local);
    if (!remote) {
      return;
    }
    if (!sync_state.enabled) {
      return;
    }

    let list_add = [];
    let set_delete = new Set();

    function onAdd(id_new) {
      list_add.push(id_new);
    }

    function onRemove(id) {
      set_delete.add(id);
      item_map.delete(id);
    }

    function onMove(id, id_new) {
      onRemove(id);
      onAdd(id_new);
    }

    let current_item_set = list.reduce((set, id) => set.add(id), new Set());
    let new_item_list = remote.filter(item => {
      if (current_item_set.has(item.id)) {
        current_item_set.delete(item.id);
        item_map.get(item.id).merge(item, onMove, onRemove);
        return false;
      }
      return true;
    });

    current_item_set.forEach(id => {
      item_map.get(id).merge(null, onMove, onRemove);
    });
    new_item_list.forEach(({ id, ver, val }) => {
      const [, setRemoteNew] = localJson(key_remote(id));
      const [, setLocalNew] = localJson(key_local(id));
      setRemoteNew({ ver, val });
      setLocalNew({ ref: ver, ver: ver, val: null });
      onAdd(id);
    });

    setList([...list.filter(id => !set_delete.has(id)), ...list_add].sort());

    getMenuRef().onSync(true);
  }

  useEffect(() => {
    if (token) {
      sync_state.manager.enable();
    } else {
      sync_state.manager.disable();
      setList(list.map(id => {
        const [remote, setRemote] = localJson(key_remote(id));
        const [local, setLocal] = localJson(key_local(id));
        if (!local) {
          return;
        }
        const { ver, val } = local;
        if (ver > 0 && val) {
          if (!remote) {
            return id;
          } else {
            id = generate_local_id(ver);
            const [, setLocalNew] = localJson(key_local(id));
            setLocalNew({ ref: 0, ver, val });
          }
        } else {
          id = null;
        }
        setRemote(null);
        setLocal(null);
        return id;
      }).filter(id => id).sort());
    }
  }, [token]);

  function onCreate() {
    sync_state.manager.op();
    setList([...list, generate_local_id()]);
  }

  function onUpdate() {
    sync_state.manager.op();
  }

  const Error = () => {
    const error_display_time = 10 * 1000;
    const [error, setError] = useState(null);

    useEffect(() => {
      setTimeout(() => {
        setError(null);
      }, error_display_time);
    });

    setErrorRef({
      setError
    });

    if (!error) {
      return null;
    }

    return (
      <PositionSticky top='0px'>
        <Placeholder height='10px' />
        <Message><Text id={error} /></Message>
        <Placeholder height='5px' />
      </PositionSticky>
    )
  }

  useEffect(() => {
    if (token && list.length > max_list_length) {
      getErrorRef().setError('list.error.overlength.message');
    }
  });

  return (
    <div className='list'>
      <Error />
      {
        list.map(id => (
          <Item
            key={id}
            item_map={item_map}
            id={id}
            onUpdate={onUpdate}
          />
        ))
      }
      <PositionAbsolute right='20px' bottom='20px'>
        <IconButton icon={<AddIcon />} title={<Text id='list.create.tooltip' />} onClick={onCreate} />
      </PositionAbsolute>
    </div>
  )
}
