(function () {
  'use strict';
  // Opt-in investigation only; no media pixels, URLs or tokens are recorded.
  if (!new URLSearchParams(location.search).has('rkmpp_debug')) return;
  const videos = new Map();
  function attach(video) {
    if (videos.has(video) || !video.requestVideoFrameCallback) return;
    const trace = [];
    let previous = null, ticket, backsteps = 0, late = 0;
    let windowStart = 0, samples = [], windows = [];
    const record = (type, detail) => {
      trace.push({type,time:Number(video.currentTime.toFixed(3)),...detail});
      if (trace.length > 24) trace.shift();
      video.dataset.cadenceTrace = JSON.stringify(trace);
    };
    const seek = () => { record('seek',{}); previous = null; };
    const reset = () => { previous = null; windowStart = 0; samples = []; };
    video.addEventListener('seeking', seek);
    video.addEventListener('play', reset);
    video.addEventListener('pause', reset);
    function frame(now, meta) {
      if (previous && !video.seeking) {
        const mediaDelta = meta.mediaTime - previous.media;
        const displayDelta = meta.expectedDisplayTime - previous.display;
        samples.push({display:displayDelta,media:mediaDelta*1000,
          frames:meta.presentedFrames-previous.frames,
          skew:(meta.mediaTime-video.currentTime)*1000,
          decode:(meta.processingDuration || 0)*1000});
        if (mediaDelta < -0.005) {
          backsteps++;
          record('backstep',{milliseconds:Number((mediaDelta*1000).toFixed(2))});
        }
        if (displayDelta > 40) {
          late++;
          record('late-frame',{milliseconds:Number(displayDelta.toFixed(2)),mediaDelta:Number(mediaDelta.toFixed(3))});
        }
      }
      if (!windowStart) windowStart = now;
      if (now-windowStart >= 5000 && samples.length) {
        const histogram = key => samples.reduce((bins,s) => {
          const bin = String(Math.round(s[key]));
          bins[bin] = (bins[bin] || 0)+1;
          return bins;
        },{});
        const range = key => [Math.min(...samples.map(s=>s[key])),Math.max(...samples.map(s=>s[key]))].map(n=>Number(n.toFixed(2)));
        windows.push({time:Number(video.currentTime.toFixed(3)),width:video.videoWidth,height:video.videoHeight,
          display:histogram('display'),media:histogram('media'),skew:range('skew'),decode:range('decode'),
          missedCallbacks:samples.reduce((n,s)=>n+Math.max(0,s.frames-1),0)});
        if (windows.length > 12) windows.shift();
        video.dataset.cadenceWindows = JSON.stringify(windows);
        windowStart = now; samples = [];
      }
      previous = {media:meta.mediaTime,display:meta.expectedDisplayTime,frames:meta.presentedFrames};
      video.dataset.frameBacksteps = String(backsteps);
      video.dataset.lateFrameEvents = String(late);
      ticket = video.requestVideoFrameCallback(frame);
    }
    ticket = video.requestVideoFrameCallback(frame);
    videos.set(video, () => {
      video.cancelVideoFrameCallback(ticket);
      video.removeEventListener('seeking',seek);
      video.removeEventListener('play',reset);
      video.removeEventListener('pause',reset);
    });
  }
  new MutationObserver(() => {
    document.querySelectorAll('video').forEach(attach);
    for (const [video, cleanup] of videos) if (!video.isConnected) {cleanup();videos.delete(video);}
  }).observe(document.documentElement,{subtree:true,childList:true});
  document.querySelectorAll('video').forEach(attach);
})();
