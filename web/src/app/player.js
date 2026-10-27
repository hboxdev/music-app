// Loading YouTube's official IFrame Player API

let apiPromise = null;

export function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev && prev();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => {
        apiPromise = null;
        reject(new Error('YouTube player failed to load. Check your connection or ad blocker.'));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

// Loads a playlist into a second, off-screen player (never played) and reads its video IDs.
// Works for normal playlists and for YouTube Mixes, no sign-in needed.
export async function readPlaylistIds(listId) {
  const YT = await loadYouTubeApi();
  return new Promise((resolve, reject) => {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:113px';
    const target = document.createElement('div');
    holder.appendChild(target);
    document.body.appendChild(holder);

    let helper;
    let timer;
    let tries = 0;
    const done = (fn, val) => {
      clearInterval(timer);
      try {
        helper && helper.destroy();
      } catch {}
      holder.remove();
      fn(val);
    };
    const fail = () => done(reject, new Error('Could not read that playlist. It may be private or empty.'));

    helper = new YT.Player(target, {
      width: '200',
      height: '113',
      playerVars: { listType: 'playlist', list: listId, autoplay: 0, mute: 1 },
      events: {
        onReady: () => {
          timer = setInterval(() => {
            const ids = helper.getPlaylist && helper.getPlaylist();
            if (ids && ids.length) done(resolve, ids);
            else if (++tries > 40) fail();
          }, 300);
        },
        onError: fail,
      },
    });
  });
}
