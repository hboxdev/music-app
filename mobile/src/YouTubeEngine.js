import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Linking, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

// YouTube's official embedded player, loaded from a public https page
// (YouTube refuses to play inside pages without a real web address).
// The page creates a global `player` object we control with injected JS.
const BASE = 'https://lonelycpp.github.io/react-native-youtube-iframe/iframe_v2.html';
const PLAYER_DATA = encodeURI(
  JSON.stringify({
    videoId_s: '',
    controls_s: 1,
    rel_s: 0,
    loop_s: 0,
    contentScale_s: 1,
    preventFullScreen_s: 0,
    modestbranding_s: 1,
    showClosedCaptions_s: 0,
    cc_lang_pref_s: '',
  })
);
const SOURCE = { uri: `${BASE}?data=${PLAYER_DATA}` };

// Desktop user agent lets Android start videos without a tap inside the player
const ANDROID_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Runs inside the page: reports playback time and can read playlist contents
const BRIDGE = `
(function () {
  function post(type, data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ eventType: type, data: data }));
  }
  setInterval(function () {
    if (window.player && player.getDuration && player.getDuration() > 0) {
      post('time', { t: player.getCurrentTime(), d: player.getDuration() });
    }
  }, 500);
  window.__readPlaylist = function (listId) {
    player.cuePlaylist({ listType: 'playlist', list: listId });
    var tries = 0;
    var timer = setInterval(function () {
      var ids = player.getPlaylist();
      if (ids && ids.length) { clearInterval(timer); post('playlistIds', ids); }
      else if (++tries > 50) { clearInterval(timer); post('playlistIds', []); }
    }, 300);
  };
})();
true;
`;

const YouTubeEngine = forwardRef(function YouTubeEngine(
  { onReady, onStateChange, onError, onTime, onPlaylistIds, style },
  ref
) {
  const web = useRef(null);
  const run = (js) => web.current && web.current.injectJavaScript(`try { ${js} } catch (e) {} true;`);

  useImperativeHandle(ref, () => ({
    load: (videoId) => run(`player.loadVideoById(${JSON.stringify(videoId)})`),
    play: () => run('player.playVideo()'),
    pause: () => run('player.pauseVideo()'),
    seekTo: (seconds) => run(`player.seekTo(${Number(seconds) || 0}, true)`),
    readPlaylist: (listId) => run(`window.__readPlaylist(${JSON.stringify(listId)})`),
  }));

  const handleMessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    switch (msg.eventType) {
      case 'playerReady':
        onReady && onReady();
        break;
      case 'playerStateChange':
        onStateChange && onStateChange(msg.data);
        break;
      case 'playerError':
        onError && onError(msg.data);
        break;
      case 'time':
        onTime && onTime(msg.data);
        break;
      case 'playlistIds':
        onPlaylistIds && onPlaylistIds(msg.data || []);
        break;
    }
  };

  // Keep the player page in place; open any YouTube link the user taps in the real browser/app
  const handleNavigation = (req) => {
    const url = req.mainDocumentURL || req.url;
    if (url.startsWith(BASE) || url === 'about:blank') return true;
    if (/^https?:/.test(url)) Linking.openURL(req.url).catch(() => {});
    return false;
  };

  return (
    <WebView
      ref={web}
      source={SOURCE}
      style={[{ backgroundColor: '#000' }, style]}
      originWhitelist={['*']}
      injectedJavaScript={BRIDGE}
      onMessage={handleMessage}
      onShouldStartLoadWithRequest={handleNavigation}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo
      bounces={false}
      scrollEnabled={false}
      userAgent={Platform.OS === 'android' ? ANDROID_UA : undefined}
    />
  );
});

export default YouTubeEngine;
