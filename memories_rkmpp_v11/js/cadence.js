(function () {
  'use strict';
  // Opt-in investigation only; no media pixels, URLs or tokens are recorded.
  if (!new URLSearchParams(location.search).has('rkmpp_debug')) return;
  const videos = new Map();
  function attach(video) {
    if (videos.has(video) || !video.requestVideoFrameCallback) return;
    const trace = [];
    let previous = null, ticket, backsteps = 0, late = 0;
    const record = (type, detail) => {
      trace.push({type,time:Number(video.currentTime.toFixed(3)),...detail});
      if (trace.length > 24) trace.shift();
      video.dataset.cadenceTrace = JSON.stringify(trace);
    };
    const seek = () => { record('seek',{}); previous = null; };
    video.addEventListener('seeking', seek);
    function frame(now, meta) {
      if (previous && !video.seeking) {
        const mediaDelta = meta.mediaTime - previous.media;
        const displayDelta = meta.expectedDisplayTime - previous.display;
        if (mediaDelta < -0.005) {
          backsteps++;
          record('backstep',{milliseconds:Number((mediaDelta*1000).toFixed(2))});
        }
        if (displayDelta > 100) {
          late++;
          record('late-frame',{milliseconds:Number(displayDelta.toFixed(2)),mediaDelta:Number(mediaDelta.toFixed(3))});
        }
      }
      previous = {media:meta.mediaTime,display:meta.expectedDisplayTime};
      video.dataset.frameBacksteps = String(backsteps);
      video.dataset.lateFrameEvents = String(late);
      ticket = video.requestVideoFrameCallback(frame);
    }
    ticket = video.requestVideoFrameCallback(frame);
    videos.set(video, () => {video.cancelVideoFrameCallback(ticket);video.removeEventListener('seeking',seek);});
  }
  new MutationObserver(() => {
    document.querySelectorAll('video').forEach(attach);
    for (const [video, cleanup] of videos) if (!video.isConnected) {cleanup();videos.delete(video);}
  }).observe(document.documentElement,{subtree:true,childList:true});
  document.querySelectorAll('video').forEach(attach);
})();
