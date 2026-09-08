(function(){
  "use strict";
  var doc=document, root=doc.documentElement, body=doc.body;
  function id(x){ return doc.getElementById(x); }
  function el(t,c){ var e=doc.createElement(t); if(c) e.className=c; return e; }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m];}); }

  var empty=id("empty"), stage=id("stage"), imgwrap=id("imgwrap"),
      spinner=id("spinner"), stageMsg=id("stageMsg"),
      fileInput=id("fileInput"), overlay=id("dropOverlay"), toastEl=id("toast"),
      docTitle=id("docTitle"), hoverZone=id("hoverZone"), bgPicker=id("bgPicker"),
      themeColor=id("themeColor"), topbar=doc.querySelector(".topbar"), brandIcon=id("brandIcon"),
      infoBody=id("infoBody"),
      btnInfo=id("btnInfo"), btnDownload=id("btnDownload"), btnClear=id("btnClear"),
      tbLvl=id("tbLvl"), tbChecker=id("tbChecker"),
      tbPrev=id("tbPrev"), tbNext=id("tbNext"), pageLbl=id("pageLbl"), pageSep=id("pageSep");

  var favLink=doc.querySelector('link[rel="icon"]');
  if(brandIcon && favLink) brandIcon.src=favLink.href;
  var BASE_TITLE="Image Viewer";

  var toastTimer=null;
  function toast(msg){ toastEl.textContent=msg; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(function(){toastEl.classList.remove("show");},2200); }
  function showSpinner(s){ spinner.hidden=!s; }
  function showMsg(title,sub){ showSpinner(false); stageMsg.innerHTML='<div><strong>'+esc(title)+'</strong>'+(sub?'<span class="mono">'+esc(sub)+'</span>':'')+'</div>'; stageMsg.hidden=false; body.classList.add("viewing"); empty.hidden=true; }
  function hideMsg(){ stageMsg.hidden=true; }

  // empty-state format chips
  var FORMAT_CHIPS=["PNG","JPEG","GIF","WebP","AVIF","SVG","BMP","ICO","TIFF","TGA","QOI","PCX","PPM","PGM","PBM","farbfeld","DDS"];
  (function(){ var box=id("emptyFormats"); for(var i=0;i<FORMAT_CHIPS.length;i++){ var s=el("span"); s.textContent=FORMAT_CHIPS[i]; box.appendChild(s); } })();

  var view=null;
  var currentName="";   // the raw uploaded filename -- this viewer otherwise
                         // tracks it only transiently through view.name

  // Reflect the loaded file's name into the URL (?name=), so a bookmarked or
  // shared link says what was being viewed. history.replaceState only, and
  // URLSearchParams does its own percent-encoding — this never touches the
  // DOM, so it carries no XSS risk on its own. The value becomes untrusted
  // input again the moment it is read back (see the on-load block near the
  // bottom of this script), and that path must stay textContent-only.
  function syncQueryName(name){
    var url=new URL(location.href);
    if(name) url.searchParams.set("name",name);
    else url.searchParams.delete("name");
    history.replaceState(null,"",url.pathname+url.search+url.hash);
  }
  var scale=1, tx=0, ty=0, natW=0, natH=0, minScale=0.02, maxScale=64;

  // ---------- detection ----------
  function extOf(name){ var m=/\.([a-z0-9]+)$/i.exec(name||""); return m?m[1].toLowerCase():""; }
  function ascii(u8,off,len){ var s=""; for(var i=0;i<len && off+i<u8.length;i++) s+=String.fromCharCode(u8[off+i]); return s; }
  function detect(name,u8){
    var e=extOf(name);
    if(u8.length>=4){
      if(u8[0]==0x89&&u8[1]==0x50&&u8[2]==0x4e&&u8[3]==0x47) return "png";
      if(u8[0]==0xff&&u8[1]==0xd8&&u8[2]==0xff) return "jpeg";
      if(u8[0]==0x47&&u8[1]==0x49&&u8[2]==0x46) return "gif";
      if(u8[0]==0x42&&u8[1]==0x4d) return "bmp";
      if(u8[0]==0x49&&u8[1]==0x49&&u8[2]==0x2a&&u8[3]==0x00) return "tiff";
      if(u8[0]==0x4d&&u8[1]==0x4d&&u8[2]==0x00&&u8[3]==0x2a) return "tiff";
      if(u8[0]==0x00&&u8[1]==0x00&&u8[2]==0x01&&u8[3]==0x00) return "ico";
      if(u8[0]==0x71&&u8[1]==0x6f&&u8[2]==0x69&&u8[3]==0x66) return "qoi";
      if(ascii(u8,0,4)=="DDS ") return "dds";
      if(ascii(u8,0,4)=="8BPS") return "psd";
    }
    if(u8.length>=12 && ascii(u8,0,4)=="RIFF" && ascii(u8,8,4)=="WEBP") return "webp";
    if(u8.length>=12 && ascii(u8,4,4)=="ftyp"){ var br=ascii(u8,8,4); if(/avif|avis/.test(br)) return "avif"; if(/heic|heix|hevc|mif1|heim|heis|msf1/.test(br)) return "heic"; }
    if(u8.length>=8 && ascii(u8,0,8)=="farbfeld") return "farbfeld";
    if(u8.length>=2 && u8[0]==0x50 && u8[1]>=0x31 && u8[1]<=0x37) return "pnm";
    if(u8.length>=2 && u8[0]==0xff && u8[1]==0x0a) return "jxl";
    if(u8.length>=2 && u8[0]==0x0a && (u8[2]==1||u8[2]==0) && e=="pcx") return "pcx";
    var head=ascii(u8,0,Math.min(400,u8.length)).replace(/^\uFEFF/,"");
    if(/<svg[\s>]/i.test(head) || (/<\?xml/i.test(head) && /<svg[\s>]/i.test(ascii(u8,0,Math.min(3000,u8.length))))) return "svg";
    var byext={png:"png",jpg:"jpeg",jpeg:"jpeg",jpe:"jpeg",jfif:"jpeg",gif:"gif",webp:"webp",avif:"avif",svg:"svg",svgz:"svg",bmp:"bmp",dib:"bmp",ico:"ico",cur:"ico",tif:"tiff",tiff:"tiff",tga:"tga",targa:"tga",icb:"tga",vda:"tga",vst:"tga",qoi:"qoi",pcx:"pcx",ppm:"pnm",pgm:"pnm",pbm:"pnm",pnm:"pnm",pam:"pnm",ff:"farbfeld",dds:"dds",psd:"psd",heic:"heic",heif:"heic",jxl:"jxl"};
    return byext[e] || "unknown";
  }

  // TIFF Compression tag (259) -> human name. Shared by decodeTIFF's skipped-page
  // warning and the info panel, so the two cannot disagree about a codec name.
  var TIFF_COMPRESSION={1:"None",2:"CCITT RLE",3:"CCITT G3",4:"CCITT G4",5:"LZW",
    6:"JPEG (old)",7:"JPEG",8:"Deflate",32773:"PackBits",32946:"Deflate"};

  var DECODERS={ tiff:decodeTIFF, tga:decodeTGA, qoi:decodeQOI, pcx:decodePCX, pnm:decodePNM, farbfeld:decodeFarbfeld, dds:decodeDDS };
  var FMT_LABEL={png:"PNG",jpeg:"JPEG",gif:"GIF",webp:"WebP",avif:"AVIF",svg:"SVG",bmp:"BMP",ico:"ICO",tiff:"TIFF",tga:"TGA (Targa)",qoi:"QOI",pcx:"PCX",pnm:"Netpbm (PNM)",farbfeld:"farbfeld",dds:"DDS",psd:"Photoshop (PSD)",heic:"HEIC / HEIF",jxl:"JPEG XL",unknown:"Image"};
  var MIME={png:"image/png",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",avif:"image/avif",svg:"image/svg+xml",bmp:"image/bmp",ico:"image/x-icon",heic:"image/heic",heif:"image/heif",jxl:"image/jxl"};

  // ---------- family router (§6.10) ----------
        /* FV-MAP-START — generated from family-map.json (canonical); deep-equality enforced by the harness */
    var FAMILY = {
      audio:    { domain:"audio-viewer.us"     , label:"Audio Viewer"     , kind:"an audio file" },
      cert:     { domain:"cert-viewer.us"      , label:"Cert Viewer"      , kind:"a certificate" },
      data:     { domain:"data-viewer.us"      , label:"Data Viewer"      , kind:"a data file" },
      docx:     { domain:"docx-viewer.us"      , label:"DOCX Viewer"      , kind:"a Word document" },
      eml:      { domain:"eml-viewer.us"       , label:"EML Viewer"       , kind:"an email file" },
      epub:     { domain:"epub-viewer.us"      , label:"EPUB Viewer"      , kind:"an e-book" },
      html:     { domain:"html-viewer.us"      , label:"HTML Viewer"      , kind:"a web or source-code file" },
      image:    { domain:"image-viewer.us"     , label:"Image Viewer"     , kind:"an image" },
      log:      { domain:"log-viewer.us"       , label:"Log Viewer"       , kind:"a log file" },
      markdown: { domain:"markdown-viewer.us"  , label:"Markdown Viewer"  , kind:"a Markdown or text file" },
      pdf:      { domain:"pdf-viewer.us"       , label:"PDF Viewer"       , kind:"a PDF" },
      pptx:     { domain:"pptx-viewer.us"      , label:"PPTX Viewer"      , kind:"a presentation" },
      pub:      { domain:"pub-viewer.us"       , label:"PUB Viewer"       , kind:"a Publisher file" },
      sheets:   { domain:"sheets-viewer.us"    , label:"Sheets Viewer"    , kind:"a spreadsheet" },
      video:    { domain:"video-viewer.us"     , label:"Video Viewer"     , kind:"a video" }
    };
    var FAMILY_HUB = "file-viewer.us";
    var FAMILY_NAMES = {"robots.txt":"html"};
    var FAMILY_MAP = {
      // sheets
      "123":"sheets", xlsx:"sheets", xlsm:"sheets", xlsb:"sheets", xls:"sheets", xlt:"sheets", xltx:"sheets", xltm:"sheets",
      xlam:"sheets", ods:"sheets", fods:"sheets", dif:"sheets", prn:"sheets", dbf:"sheets", numbers:"sheets", xlml:"sheets",
      wk1:"sheets", wk3:"sheets", wks:"sheets", et:"sheets", uos:"sheets",
      // cert
      pem:"cert", crt:"cert", cer:"cert", der:"cert", csr:"cert", cert:"cert", p7b:"cert", p12:"cert",
      pfx:"cert",
      // data
      json:"data", jsonc:"data", json5:"data", jsonld:"data", ndjson:"data", yaml:"data", yml:"data", toml:"data",
      csv:"data", tsv:"data", xml:"data", rss:"data", atom:"data", graphql:"data", gql:"data",
      // docx
      docx:"docx", docm:"docx", dotx:"docx", dotm:"docx", doc:"docx", dot:"docx", rtf:"docx", odt:"docx",
      // eml
      eml:"eml", mbox:"eml", emlx:"eml", msg:"eml",
      // epub
      epub:"epub",
      // html
      html:"html", htm:"html", xhtml:"html", xht:"html", shtml:"html", shtm:"html", stm:"html", hta:"html",
      mhtml:"html", mht:"html", css:"html", scss:"html", sass:"html", less:"html", styl:"html", pcss:"html",
      postcss:"html", js:"html", mjs:"html", cjs:"html", jsx:"html", ts:"html", mts:"html", cts:"html",
      tsx:"html", coffee:"html", htaccess:"html", htpasswd:"html", env:"html", ini:"html", conf:"html", webmanifest:"html",
      map:"html", php:"html", phtml:"html", asp:"html", aspx:"html", ascx:"html", cshtml:"html", vbhtml:"html",
      jsp:"html", jspx:"html", cfm:"html", erb:"html", rhtml:"html", ejs:"html", hbs:"html", handlebars:"html",
      mustache:"html", njk:"html", liquid:"html", jinja:"html", j2:"html", twig:"html", pug:"html", jade:"html",
      haml:"html", slim:"html", vue:"html", svelte:"html", astro:"html",
      // image
      png:"image", jpg:"image", jpeg:"image", jpe:"image", jfif:"image", gif:"image", webp:"image", avif:"image",
      svg:"image", svgz:"image", bmp:"image", dib:"image", ico:"image", cur:"image", tif:"image", tiff:"image",
      tga:"image", targa:"image", icb:"image", vda:"image", vst:"image", qoi:"image", pcx:"image", ppm:"image",
      pgm:"image", pbm:"image", pnm:"image", pam:"image", ff:"image", dds:"image", heic:"image", heif:"image",
      jxl:"image", psd:"image",
      // log
      log:"log", out:"log", err:"log", trace:"log", syslog:"log",
      // markdown
      md:"markdown", markdown:"markdown", mdx:"markdown", txt:"markdown", rst:"markdown", adoc:"markdown",
      // pdf
      pdf:"pdf",
      // pptx
      pptx:"pptx", pptm:"pptx", ppsx:"pptx", ppsm:"pptx", potx:"pptx", potm:"pptx", ppt:"pptx",
      // pub
      pub:"pub",
      // audio
      mp3:"audio", wav:"audio", flac:"audio", m4a:"audio", aac:"audio", ogg:"audio", oga:"audio", opus:"audio",
      weba:"audio", mka:"audio", aif:"audio", aiff:"audio", wma:"audio", mid:"audio", midi:"audio",
      // video
      webm:"video", mp4:"video", m4v:"video", ogv:"video", mov:"video", mkv:"video", avi:"video", wmv:"video"
    };
    /* FV-MAP-END */
    var FAMILY_ORIGINS = Object.keys(FAMILY).map(function (k) { return "https://" + FAMILY[k].domain; })
      .concat("https://" + FAMILY_HUB);
  var DOMAIN = "image-viewer.us";

  var routeFile=null, routeKey="", routePrevFocus=null, handoff=null;
  function cancelHandoff(){                    // tear down a pending hand-off (sender below)
    if(!handoff) return;
    window.removeEventListener("message", handoff.onMsg);
    clearTimeout(handoff.timer);
    handoff=null;
  }
  function showRouteCard(file,key){
    cancelHandoff();                           // a new offer aborts any pending hand-off
    if(id("routeCard").hidden) routePrevFocus=document.activeElement;  // don't capture our own button
    routeFile=file; routeKey=key;
    var t=FAMILY[key];
    // ⁨…⁩ (FSI…PDI) bidi-isolate the untrusted name so U+202E-style
    // overrides can't visually reorder the sentence.
    id("routeMsg").textContent="“⁨"+file.name+"⁩” looks like "+t.kind+" — it belongs to "+t.label+".";
    id("routeGo").textContent="Open "+t.domain+" ↗";
    id("routeSub").textContent="Your file stays on this device — nothing is uploaded.";
    id("routeGo").disabled=false;
    id("routeBackdrop").hidden=false; id("routeCard").hidden=false;
    id("routeGo").focus();
  }
  function hideRouteCard(){
    cancelHandoff();                           // dismissal aborts a pending hand-off
    id("routeBackdrop").hidden=true; id("routeCard").hidden=true;
    routeFile=null; routeKey="";
    if(routePrevFocus && routePrevFocus.focus) routePrevFocus.focus();
  }
  function familyRoute(file){
    var n=String(file && file.name || "").toLowerCase();
    var key=FAMILY_NAMES[n];
    if(!key){
      var i=n.lastIndexOf(".");
      var ext=i>=0?n.slice(i+1):"";
      key=FAMILY_MAP[ext];
    }
    if(!key || FAMILY[key].domain===DOMAIN) return false;  // unknown type, or our own → caller keeps its message card
    showRouteCard(file,key);
    return true;
  }
  // No accept gate here (magic-byte sniffing): the router hooks the failure
  // path instead — offer the card, else fall back to the message card.
  function routeOrMsg(file,title,sub){
    if(familyRoute(file)){ clearView(true); return; }
    showMsg(title,sub);
  }

  id("routeGo").addEventListener("click", function(){
    if(!routeFile || id("routeGo").disabled) return;               // no double-fire
    cancelHandoff();
    var t=FAMILY[routeKey], origin="https://"+t.domain, file=routeFile;
    var w=window.open(origin+"/#fvh="+encodeURIComponent(file.name));
    if(!w){ id("routeSub").textContent="Couldn’t open the tab — allow pop-ups for this site and try again."; return; }
    id("routeGo").disabled=true;
    var h={};
    h.onMsg=function(e){
      if(e.source!==w || e.origin!==origin || !e.data) return;
      if(e.data.type==="fv-ready") w.postMessage({ type:"fv-file", file:file }, origin);
      else if(e.data.type==="fv-ack"){ hideRouteCard(); toast("Sent to "+t.label); }  // hideRouteCard tears the handshake down
    };
    h.timer=setTimeout(function(){
      if(handoff!==h) return;
      cancelHandoff();
      id("routeSub").textContent="Tab opened — drop the file there.";   // Level-1 fallback
    }, 10000);
    handoff=h;
    window.addEventListener("message", h.onMsg);
  });
  id("routeDismiss").addEventListener("click", hideRouteCard);
  id("routeBackdrop").addEventListener("click", hideRouteCard);

  // Receiver — a sibling tab (or the hub) hands a File across via postMessage.
  window.addEventListener("message", function(e){
    if(FAMILY_ORIGINS.indexOf(e.origin)===-1) return;      // family origins only
    var d=e.data;
    if(d && d.type==="fv-file" && d.file instanceof File){ // clone re-creates a real File in this realm
      readFile(d.file);
      e.source.postMessage({ type:"fv-ack" }, e.origin);   // ack = received and handed to the loader
    }
  });
  var fvh=/[#&]fvh=([^&]*)/.exec(location.hash);
  if(fvh){
    var fvhName=fvh[1];                                    // ⚠️ stranger-controlled — textContent only
    try{ fvhName=decodeURIComponent(fvhName); }catch(_){}  // malformed %-escapes must not kill the page
    history.replaceState(null,"",location.pathname+location.search);  // always clear, opener or not
    if(window.opener){
      try{ window.opener.postMessage({ type:"fv-ready" }, "*"); }catch(_){}
      window.opener=null;    // sever the reverse-navigation channel once the ping is out
      var emptySub=doc.querySelector(".empty-sub");
      if(emptySub){
        var emptySubText=emptySub.textContent;
        emptySub.textContent="Receiving “⁨"+fvhName+"⁩”…";
        setTimeout(function(){ emptySub.textContent=emptySubText; }, 10000);
      }
    }
  }

  // A bookmarked or shared link can carry the name of the file last viewed
  // (?name=, set by syncQueryName above). No content is ever recoverable
  // from a name alone — this only labels the empty state, and it never
  // fetches or renders anything on the strength of it. Skipped when an
  // #fvh hand-off is already customizing the same element.
  if(!fvh && !currentName){
    var qName=new URLSearchParams(location.search).get("name");
    if(qName){
      var lastSub=doc.querySelector(".empty-sub");
      if(lastSub){
        // Display-only, and it must stay that way: this string is read
        // straight from the URL, so it is exactly as stranger-controlled as
        // fvhName above. No fact is asserted about whether anyone actually
        // viewed it — only that the link names it.
        lastSub.textContent="This link was shared for “⁨"+qName+"⁩”.";
      }
    }
  }

  // ---------- open / read ----------
  function openDialog(){ fileInput.value=""; fileInput.click(); }
  fileInput.addEventListener("change", function(){ if(fileInput.files&&fileInput.files[0]) readFile(fileInput.files[0]); });
  empty.addEventListener("click", openDialog);
  empty.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDialog(); } });

  function readFile(file){
    if(!file) return;
    if(!id("routeCard").hidden) hideRouteCard();   // a new file supersedes an open offer
    clearView(false); showSpinner(true); hideMsg();
    body.classList.add("viewing"); empty.hidden=true;
    currentName=file.name||""; syncQueryName(currentName);
    var reader=new FileReader();
    reader.onerror=function(){ showMsg("Couldn't read the file", file.name); };
    reader.onload=function(){
      var buf=reader.result, u8=new Uint8Array(buf);
      var fmt=detect(file.name,u8);
      try { handle(file,buf,u8,fmt); }
      catch(err){ showMsg("Couldn't open "+(FMT_LABEL[fmt]||"image"), (err&&err.message)||String(err)); }
    };
    reader.readAsArrayBuffer(file);
  }

  function handle(file,buf,u8,fmt){
    var meta={ name:file.name, fmt:fmt, label:FMT_LABEL[fmt]||"Image", bytes:file.size, width:0, height:0, alpha:null };
    if(DECODERS[fmt]){
      var res;
      try{ res=DECODERS[fmt](u8); }
      catch(err){ routeOrMsg(file, "Couldn't decode "+meta.label, (err&&err.message)||String(err)); return; }
      if(!res||!res.pages||!res.pages.length){ routeOrMsg(file, "Couldn't decode "+meta.label, "No image data"); return; }
      buildDecoded(res,meta);
      if(res.notice) toast(res.notice);   // partial decode: the page still renders
      return;
    }
    tryNative(file,buf,u8,meta,fmt);
  }

  function tryNative(file,buf,u8,meta,fmt){
    var blob=new Blob([buf], MIME[fmt]?{type:MIME[fmt]}:undefined);
    var url=URL.createObjectURL(blob);
    var img=new Image();
    img.decoding="async";
    img.onload=function(){
      meta.width=img.naturalWidth||img.width; meta.height=img.naturalHeight||img.height;
      enrichMeta(meta,u8,fmt);
      view={ name:file.name, fmt:fmt, kind:"native", imgEl:img, blob:blob, blobUrl:url, meta:meta, pages:null, pageIndex:0 };
      imgwrap.innerHTML=""; imgwrap.appendChild(img);
      natW=meta.width; natH=meta.height;
      afterLoad();
    };
    img.onerror=function(){
      URL.revokeObjectURL(url);
      var hint=(fmt=="heic"||fmt=="heif")?"HEIC/HEIF displays only in browsers with native support (e.g. Safari). Try exporting to PNG/JPEG.":
               (fmt=="jxl")?"JPEG XL isn't supported by this browser yet.":
               (fmt=="psd")?"Photoshop .psd files aren't supported yet — export a PNG/TIFF.":
               "This browser can't natively display this format.";
      routeOrMsg(file, "Can't display "+(meta.label||"this image"), hint);
    };
    img.src=url;
  }

  function buildDecoded(res,meta){
    var pages=[];
    for(var i=0;i<res.pages.length;i++){
      var pg=res.pages[i];
      var c=el("canvas"); c.width=pg.w; c.height=pg.h;
      var ctx=c.getContext("2d");
      var idata=ctx.createImageData(pg.w,pg.h);
      idata.data.set(pg.rgba);
      ctx.putImageData(idata,0,0);
      pages.push({canvas:c,w:pg.w,h:pg.h});
    }
    if(res.meta){ for(var k in res.meta){ if(Object.prototype.hasOwnProperty.call(res.meta, k)) meta[k]=res.meta[k]; } }
    meta.width=pages[0].w; meta.height=pages[0].h; meta.frames=pages.length;
    view={ name:meta.name, fmt:meta.fmt, kind:"decoded", imgEl:null, pages:pages, pageIndex:0, meta:meta, blobUrl:null };
    showPage(0);
    afterLoad();
  }
  function showPage(i){
    view.pageIndex=i;
    var pg=view.pages[i];
    imgwrap.innerHTML=""; imgwrap.appendChild(pg.canvas);
    natW=pg.w; natH=pg.h; view.meta.width=pg.w; view.meta.height=pg.h;
  }

  function afterLoad(){
    showSpinner(false); hideMsg();
    body.classList.add("viewing"); empty.hidden=true;
    btnInfo.hidden=false; btnDownload.hidden=false; btnClear.hidden=false;
    var nm=view.name||BASE_TITLE;
    docTitle.textContent=nm; doc.title=(view.name?view.name+" — ":"")+BASE_TITLE;
    view.meta.megapixels=(view.meta.width&&view.meta.height)?((view.meta.width*view.meta.height)/1e6).toFixed(2)+" MP":null;
    updatePageNav(); fitToStage(); fillInfo(); armIdleHide();
  }

  function clearView(toEmpty){
    if(view&&view.blobUrl){ try{ URL.revokeObjectURL(view.blobUrl); }catch(e){} }
    view=null; imgwrap.innerHTML=""; hideMsg(); showSpinner(false);
    scale=1; tx=0; ty=0; natW=0; natH=0;
    setInfo(false);
    btnInfo.hidden=true; btnDownload.hidden=true; btnClear.hidden=true;
    if(toEmpty){ body.classList.remove("viewing","hdr-hidden"); empty.hidden=false; docTitle.textContent=BASE_TITLE; doc.title=BASE_TITLE; currentName=""; syncQueryName(""); }
  }
  btnClear.addEventListener("click", function(){ clearView(true); });

  // ---------- zoom / pan ----------
  function stageSize(){ return {w:stage.clientWidth,h:stage.clientHeight}; }
  function applyTransform(){
    imgwrap.style.width=natW+"px"; imgwrap.style.height=natH+"px";
    imgwrap.style.transform="translate("+tx+"px,"+ty+"px) scale("+scale+")";
    imgwrap.classList.toggle("pixelated", scale>=2 && view && view.fmt!=="svg");
    tbLvl.textContent=Math.round(scale*100)+"%";
  }
  function clampScale(s){ return Math.max(minScale,Math.min(maxScale,s)); }
  function fitScale(){ var ss=stageSize(); var s=Math.min(ss.w/natW, ss.h/natH); if(!isFinite(s)||s<=0) s=1; return s; }
  function fitToStage(){ var ss=stageSize(); scale=clampScale(fitScale()); tx=(ss.w-natW*scale)/2; ty=(ss.h-natH*scale)/2; applyTransform(); }
  function setActual(){ var ss=stageSize(); scale=clampScale(1); tx=(ss.w-natW*scale)/2; ty=(ss.h-natH*scale)/2; applyTransform(); }
  function zoomAt(cx,cy,factor){ var ns=clampScale(scale*factor); if(ns===scale) return; tx=cx-(cx-tx)*(ns/scale); ty=cy-(cy-ty)*(ns/scale); scale=ns; applyTransform(); }
  function zoomCenter(factor){ var ss=stageSize(); zoomAt(ss.w/2,ss.h/2,factor); }

  stage.addEventListener("wheel", function(e){ if(!view) return; e.preventDefault(); var r=stage.getBoundingClientRect(); zoomAt(e.clientX-r.left,e.clientY-r.top, Math.pow(1.0016,-e.deltaY)); revealHeader(); }, {passive:false});

  var pointers={}, pinchPrev=0, dragLast=null;
  function pcount(){ var n=0,k; for(k in pointers) if(Object.prototype.hasOwnProperty.call(pointers, k)) n++; return n; }
  function twoPts(){ var a=[],k; for(k in pointers){ if(Object.prototype.hasOwnProperty.call(pointers, k)) a.push(pointers[k]); } return a; }
  stage.addEventListener("pointerdown", function(e){ if(!view) return; try{stage.setPointerCapture(e.pointerId);}catch(x){} pointers[e.pointerId]={x:e.clientX,y:e.clientY}; var n=pcount(); if(n==1){ dragLast={x:e.clientX,y:e.clientY}; stage.classList.add("grabbing"); } else if(n==2){ var p=twoPts(); pinchPrev=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y); } });
  stage.addEventListener("pointermove", function(e){ if(!view){ return; } if(!pointers[e.pointerId]){ if(e.clientY<70) revealHeader(); return; } pointers[e.pointerId]={x:e.clientX,y:e.clientY}; var n=pcount(); if(n==1&&dragLast){ tx+=e.clientX-dragLast.x; ty+=e.clientY-dragLast.y; dragLast={x:e.clientX,y:e.clientY}; applyTransform(); } else if(n==2){ var p=twoPts(); var d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y); if(pinchPrev>0){ var r=stage.getBoundingClientRect(); zoomAt((p[0].x+p[1].x)/2-r.left,(p[0].y+p[1].y)/2-r.top, d/pinchPrev); } pinchPrev=d; } });
  function endPtr(e){ if(pointers[e.pointerId]) delete pointers[e.pointerId]; var n=pcount(); if(n<2) pinchPrev=0; if(n==0){ dragLast=null; stage.classList.remove("grabbing"); } else { var p=twoPts(); dragLast={x:p[0].x,y:p[0].y}; } }
  stage.addEventListener("pointerup", endPtr); stage.addEventListener("pointercancel", endPtr);
  stage.addEventListener("dblclick", function(e){ if(!view) return; var f=fitScale(); var r=stage.getBoundingClientRect(); if(Math.abs(scale-clampScale(f))<0.005){ zoomAt(e.clientX-r.left,e.clientY-r.top, 1/scale); } else fitToStage(); });

  id("tbZoomOut").addEventListener("click", function(){ zoomCenter(1/1.4); });
  id("tbZoomIn").addEventListener("click", function(){ zoomCenter(1.4); });
  tbLvl.addEventListener("click", setActual);
  id("tbFit").addEventListener("click", fitToStage);
  id("tbActual").addEventListener("click", setActual);
  tbChecker.addEventListener("click", function(){ var on=imgwrap.classList.toggle("checker"); tbChecker.classList.toggle("active",on); tbChecker.setAttribute("aria-pressed",on?"true":"false"); });
  tbPrev.addEventListener("click", function(){ if(view&&view.kind=="decoded"&&view.pageIndex>0){ showPage(view.pageIndex-1); updatePageNav(); fitToStage(); fillInfo(); } });
  tbNext.addEventListener("click", function(){ if(view&&view.kind=="decoded"&&view.pageIndex<view.pages.length-1){ showPage(view.pageIndex+1); updatePageNav(); fitToStage(); fillInfo(); } });
  function updatePageNav(){ var multi=view&&view.kind=="decoded"&&view.pages.length>1; [pageSep,tbPrev,tbNext,pageLbl].forEach(function(x){ x.hidden=!multi; }); if(multi){ pageLbl.textContent=(view.pageIndex+1)+" / "+view.pages.length; tbPrev.disabled=view.pageIndex==0; tbNext.disabled=view.pageIndex==view.pages.length-1; } }

  window.addEventListener("resize", function(){ if(view) applyTransform(); });
  window.addEventListener("keydown", function(e){
    if(!id("routeCard").hidden){                   // family-router card is modal (§6.10)
      if(e.key==="Escape"){ hideRouteCard(); return; }
      if(e.key==="Tab"){ e.preventDefault(); var go=id("routeGo"), no=id("routeDismiss"); (doc.activeElement===go||go.disabled?no:go).focus(); }
      return;                                      // zoom/pan keys stay quiet beneath the card
    }
    if(!view) return;
    if(e.key=="+"||e.key=="="){ zoomCenter(1.4); } else if(e.key=="-"||e.key=="_"){ zoomCenter(1/1.4); }
    else if(e.key=="0"){ fitToStage(); } else if(e.key=="1"){ setActual(); }
    else if(e.key=="ArrowLeft"){ tbPrev.click(); } else if(e.key=="ArrowRight"){ tbNext.click(); }
    else if(e.key=="Escape"){ if(body.classList.contains("info-open")) setInfo(false); }
  });

  // ---------- download ----------
  btnDownload.addEventListener("click", function(){
    if(!view) return;
    if(view.kind=="native"){ downloadBlob(view.blob||new Blob([]), view.name); toast("Downloaded original"); }
    else { var c=view.pages[view.pageIndex].canvas; var nm=baseName(view.name)+(view.pages.length>1?("-p"+(view.pageIndex+1)):"")+".png";
      if(c.toBlob){ c.toBlob(function(b){ if(b){ downloadBlob(b,nm); toast("Exported PNG"); } else toast("Export failed"); },"image/png"); }
      else { downloadDataURL(c.toDataURL("image/png"), nm); toast("Exported PNG"); } }
  });
  function baseName(n){ return (n||"image").replace(/\.[^.]+$/,""); }
  function downloadBlob(blob,name){ downloadDataURL(URL.createObjectURL(blob),name,true); }
  function downloadDataURL(href,name,revoke){ var a=el("a"); a.href=href; a.download=name||"image"; doc.body.appendChild(a); a.click(); doc.body.removeChild(a); if(revoke) setTimeout(function(){URL.revokeObjectURL(href);},3000); }

  // ---------- info panel ----------
  btnInfo.addEventListener("click", function(){ setInfo(!body.classList.contains("info-open")); });
  id("btnInfoClose").addEventListener("click", function(){ setInfo(false); });
  function setInfo(open){ body.classList.toggle("info-open",open); btnInfo.classList.toggle("active",open); btnInfo.setAttribute("aria-pressed",open?"true":"false"); }
  function fmtBytes(b){ if(b==null) return "—"; if(b<1024) return b+" B"; if(b<1048576) return (b/1024).toFixed(1)+" KB"; return (b/1048576).toFixed(2)+" MB"; }
  function irow(k,v,mono){ return '<div class="info-row"><span class="k">'+esc(k)+'</span><span class="v'+(mono?" mono":"")+'">'+esc(v)+'</span></div>'; }
  function fillInfo(){
    if(!view) return;
    var m=view.meta,h="";
    h+='<div class="info-sec">File</div>';
    h+=irow("Name",m.name||"—");
    h+=irow("Format",m.label||"—");
    h+=irow("File size",fmtBytes(m.bytes));
    h+='<div class="info-sec">Image</div>';
    h+=irow("Dimensions",(m.width||"?")+" × "+(m.height||"?")+" px");
    if(m.megapixels) h+=irow("Megapixels",m.megapixels);
    if(m.colorType) h+=irow("Color",m.colorType);
    if(m.bitDepth) h+=irow("Bit depth",m.bitDepth+"-bit"+(m.channels?(" · "+m.channels+" ch"):""));
    if(m.alpha!=null) h+=irow("Transparency",m.alpha?"Yes (alpha)":"No");
    if(m.compression) h+=irow("Compression",m.compression);
    if(view.kind=="decoded"&&view.pages.length>1) h+=irow("Pages",view.pages.length+" · viewing "+(view.pageIndex+1));
    else if(m.animated) h+=irow("Animation","Animated");
    h+=irow("Rendered by", view.kind=="native"?"Browser":"Built-in decoder");
    if(m.exif){ var e=m.exif,added=false;
      function er(k,v){ if(v!=null&&v!==""){ if(!added){ h+='<div class="info-sec">EXIF</div>'; added=true; } h+=irow(k,v); } }
      er("Camera",[e.Make,e.Model].filter(Boolean).join(" "));
      er("Lens",e.Lens);
      er("Taken",e.DateTimeOriginal||e.DateTime);
      er("Exposure",e.ExposureTime);
      er("Aperture",e.FNumber);
      er("ISO",e.ISO);
      er("Focal length",e.FocalLength);
      er("Orientation",e.OrientationText);
    }
    infoBody.innerHTML=h;
  }

  // ---------- native metadata enrichment ----------
  function be32(u8,o){ return (u8[o]*16777216)+(u8[o+1]<<16)+(u8[o+2]<<8)+u8[o+3]; }
  function enrichMeta(meta,u8,fmt){
    try{
      if(fmt=="png") pngMeta(meta,u8);
      else if(fmt=="jpeg") jpegMeta(meta,u8);
      else if(fmt=="gif") gifMeta(meta,u8);
      else if(fmt=="webp"){ meta.compression="VP8"; }
      else if(fmt=="avif"){ meta.compression="AV1"; }
      else if(fmt=="svg"){ meta.colorType="Vector"; meta.compression="—"; }
      else if(fmt=="bmp"){ meta.compression="None / RLE"; }
      else if(fmt=="ico"){ meta.colorType="Icon"; if(u8[4]!=null){ meta.frames=(u8[4]|(u8[5]<<8)); } }
    }catch(e){}
  }
  function pngMeta(meta,u8){
    if(u8.length<26) return;
    var bd=u8[24], ct=u8[25];
    var cts={0:"Grayscale",2:"RGB",3:"Indexed (palette)",4:"Grayscale + alpha",6:"RGBA"};
    meta.bitDepth=bd; meta.colorType=cts[ct]||("type "+ct); meta.alpha=(ct==4||ct==6); meta.compression="Deflate";
    var p=8, guard=0;
    while(p+8<=u8.length && guard++<5000){ var len=be32(u8,p); var typ=ascii(u8,p+4,4); if(typ=="tRNS") meta.alpha=true; if(typ=="acTL"){ meta.animated=true; } if(typ=="IDAT"||typ=="IEND") break; if(len<0||len>u8.length) break; p+=12+len; }
    if(meta.animated) meta.colorType+=" · APNG";
  }
  function jpegMeta(meta,u8){
    var p=2,n=u8.length,guard=0;
    while(p+4<n && guard++<2000){
      if(u8[p]!=0xff){ p++; continue; }
      var mk=u8[p+1];
      if(mk==0xd8||mk==0xd9){ p+=2; continue; }
      if(mk>=0xd0&&mk<=0xd7){ p+=2; continue; }
      var len=(u8[p+2]<<8)|u8[p+3];
      if(mk>=0xc0&&mk<=0xcf&&mk!=0xc4&&mk!=0xc8&&mk!=0xcc){ var prec=u8[p+4],comps=u8[p+9]; meta.bitDepth=prec; meta.channels=comps; meta.colorType=comps==1?"Grayscale":comps==3?"YCbCr":comps==4?"CMYK":comps+" components"; meta.alpha=false; }
      if(mk==0xe1 && ascii(u8,p+4,4)=="Exif"){ try{ meta.exif=parseExif(u8,p+10); }catch(e){} }
      if(mk==0xda) break;
      p+=2+len;
    }
    meta.compression="JPEG (DCT)";
  }
  function gifMeta(meta,u8){
    meta.colorType="Indexed (palette)"; meta.compression="LZW";
    var p=13, packed=u8[10]; if(packed&0x80){ p+=(2<<(packed&7))*3; }
    var frames=0, guard=0;
    while(p<u8.length && guard++<100000){
      var b=u8[p];
      if(b==0x2c){ frames++; var lp=u8[p+9]; p+=10; if(lp&0x80){ p+=(2<<(lp&7))*3; } p++; while(p<u8.length){ var bl=u8[p++]; if(!bl)break; p+=bl; } }
      else if(b==0x21){ if(u8[p+1]==0xf9 && (u8[p+3]&1)) meta.alpha=true; p+=2; while(p<u8.length){ var bl2=u8[p++]; if(!bl2)break; p+=bl2; } }
      else if(b==0x3b){ break; } else { p++; }
    }
    if(meta.alpha==null) meta.alpha=false;
    if(frames>1){ meta.animated=true; meta.frames=frames; }
  }
  function parseExif(u8,base){
    if(base+8>u8.length) return null;
    var le=u8[base]==0x49;
    function u16(o){ o+=base; return le?(u8[o]|(u8[o+1]<<8)):((u8[o]<<8)|u8[o+1]); }
    function u32(o){ o+=base; return le?((u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16))+u8[o+3]*16777216):(u8[o]*16777216+(u8[o+1]<<16)+(u8[o+2]<<8)+u8[o+3]); }
    if(u16(2)!=0x2a) return null;
    var out={}, exifPtr=0;
    var TAG={0x010f:"Make",0x0110:"Model",0x0112:"Orientation",0x0132:"DateTime",0x8769:"_Exif",0x829a:"ExposureTime",0x829d:"FNumber",0x8827:"ISO",0x9003:"DateTimeOriginal",0x920a:"FocalLength",0xa434:"Lens",0xa500:"_x"};
    function val(eo,type,num){ var sz={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8}[type]||1; var total=sz*num; var vo=total<=4?(eo+8):u32(eo+8); if(type==2){ var s="",i; for(i=0;i<num;i++){ var c=u8[base+vo+i]; if(!c)break; s+=String.fromCharCode(c); } return s.replace(/\0.*$/,"").trim(); } if(type==3) return u16(vo); if(type==4) return u32(vo); if(type==5||type==10) return [u32(vo),u32(vo+4)]; return u16(vo); }
    function ifd(off){ if(off<=0||base+off+2>u8.length) return; var cnt=u16(off); if(cnt>500) return; for(var i=0;i<cnt;i++){ var eo=off+2+i*12; var tag=u16(eo),type=u16(eo+2),num=u32(eo+4); var nm=TAG[tag]; if(!nm) continue; var v=val(eo,type,num); if(nm=="_Exif") exifPtr=v; else if(nm[0]!="_") out[nm]=v; } }
    ifd(u32(4)); if(exifPtr) ifd(exifPtr);
    var res={Make:out.Make,Model:out.Model,DateTimeOriginal:out.DateTimeOriginal,DateTime:out.DateTime,ISO:out.ISO,Lens:out.Lens};
    if(out.Make&&out.Model&&out.Model.indexOf(out.Make)==0) res.Make="";
    function ratio(r){ return r&&r[1]?r[0]/r[1]:null; }
    var et=ratio(out.ExposureTime); if(et!=null) res.ExposureTime=et>=1?et+" s":"1/"+Math.round(1/et)+" s";
    var fn=ratio(out.FNumber); if(fn!=null) res.FNumber="f/"+(Math.round(fn*10)/10);
    var fl=ratio(out.FocalLength); if(fl!=null) res.FocalLength=(Math.round(fl*10)/10)+" mm";
    if(out.Orientation){ res.OrientationText={1:"Normal",2:"Flip H",3:"Rotate 180°",4:"Flip V",5:"Transpose",6:"Rotate 90° CW",7:"Transverse",8:"Rotate 270° CW"}[out.Orientation]||String(out.Orientation); }
    return res;
  }

  // =====================================================================
  //  Decoders (pure JS). Each returns { pages:[{w,h,rgba:Uint8ClampedArray}], meta:{} }
  // =====================================================================
  function decodeTIFF(u8){
    if(typeof self.UTIF==="undefined") throw new Error("TIFF decoder unavailable");
    var buf=u8.buffer.slice(u8.byteOffset, u8.byteOffset+u8.byteLength);
    var ifds=self.UTIF.decode(buf);
    if(!ifds||!ifds.length) throw new Error("No TIFF images");
    // Pages the loop drops are counted, and the two reasons are kept apart: a
    // decoder throw is a codec problem and names the codec, while missing
    // dimensions or pixels is a layout problem and must not be reported as one.
    var pages=[], first=null, lostCodec=[], lostEmpty=0;
    for(var i=0;i<ifds.length;i++){
      var ifd=ifds[i];
      try{ self.UTIF.decodeImage(buf, ifd, ifds); }
      catch(e){ lostCodec.push(ifd.t259?ifd.t259[0]:1); continue; }
      var rgba=self.UTIF.toRGBA8(ifd);
      var w=ifd.width||ifd.t256&&ifd.t256[0], hh=ifd.height||ifd.t257&&ifd.t257[0];
      if(!w||!hh||!rgba||!rgba.length){ lostEmpty++; continue; }
      pages.push({w:w,h:hh,rgba:new Uint8ClampedArray(rgba.buffer||rgba)});
      if(!first) first=ifd;
    }
    if(!pages.length) throw new Error("Unsupported TIFF (compression or layout)");
    // PARTIAL loss was previously silent: the document simply rendered short,
    // which looks like success. Total loss already throws above and is honest.
    var notice="";
    var lost=lostCodec.length+lostEmpty;
    if(lost){
      var why=[];
      if(lostCodec.length){
        var seen={}, names=[];
        for(var c=0;c<lostCodec.length;c++){
          var nm=TIFF_COMPRESSION[lostCodec[c]]||("compression code "+lostCodec[c]);
          if(!seen[nm]){ seen[nm]=1; names.push(nm); }
        }
        why.push("unsupported compression: "+names.join(", "));
      }
      if(lostEmpty) why.push(lostEmpty+" with no image data");
      notice=lost+" of "+ifds.length+" pages could not be decoded — "+why.join("; ");
    }
    var meta={};
    if(first){
      var bps=first.t258; meta.bitDepth=bps?(bps[0]||bps):8;
      meta.channels=bps&&bps.length?bps.length:undefined;
      var comp=first.t259?first.t259[0]:1;
      meta.compression=TIFF_COMPRESSION[comp]||("code "+comp);
      var photo=first.t262?first.t262[0]:2;
      meta.colorType={0:"Grayscale (min-is-white)",1:"Grayscale",2:"RGB",3:"Indexed (palette)",5:"CMYK",6:"YCbCr"}[photo]||"—";
      var spp=first.t277?first.t277[0]:0; meta.alpha=(spp>=4)||(first.t338!=null);
    }
    return {pages:pages, meta:meta, notice:notice};
  }

  function decodeQOI(u8){
    if(!(u8[0]==0x71&&u8[1]==0x6f&&u8[2]==0x69&&u8[3]==0x66)) throw new Error("Not a QOI file");
    var w=be32(u8,4), h=be32(u8,8), ch=u8[12];
    if(!w||!h||w*h>268435456) throw new Error("Bad QOI dimensions");
    var px=new Uint8ClampedArray(w*h*4), idx=new Uint8Array(256);
    var r=0,g=0,b=0,a=255,p=14,o=0,run=0,end=u8.length-8;
    for(var i=0;i<w*h;i++){
      if(run>0){ run--; }
      else if(p<end){
        var b1=u8[p++];
        if(b1==0xfe){ r=u8[p++]; g=u8[p++]; b=u8[p++]; }
        else if(b1==0xff){ r=u8[p++]; g=u8[p++]; b=u8[p++]; a=u8[p++]; }
        else{ var op=b1>>6;
          if(op==0){ var ix=(b1&63)*4; r=idx[ix]; g=idx[ix+1]; b=idx[ix+2]; a=idx[ix+3]; }
          else if(op==1){ r=(r+((b1>>4&3)-2))&255; g=(g+((b1>>2&3)-2))&255; b=(b+((b1&3)-2))&255; }
          else if(op==2){ var b2=u8[p++]; var vg=(b1&63)-32; r=(r+vg-8+(b2>>4&15))&255; g=(g+vg)&255; b=(b+vg-8+(b2&15))&255; }
          else{ run=(b1&63); }
        }
        var h2=((r*3+g*5+b*7+a*11)&63)*4; idx[h2]=r; idx[h2+1]=g; idx[h2+2]=b; idx[h2+3]=a;
      }
      px[o++]=r; px[o++]=g; px[o++]=b; px[o++]=a;
    }
    return {pages:[{w:w,h:h,rgba:px}], meta:{bitDepth:8,channels:ch,colorType:ch==4?"RGBA":"RGB",alpha:ch==4,compression:"QOI"}};
  }

  function decodeFarbfeld(u8){
    for(var k=0;k<8;k++) if(u8[k]!="farbfeld".charCodeAt(k)) throw new Error("Not a farbfeld file");
    var w=be32(u8,8), h=be32(u8,12);
    if(!w||!h||16+w*h*8>u8.length+8) throw new Error("Bad farbfeld size");
    var px=new Uint8ClampedArray(w*h*4), p=16, o=0;
    for(var i=0;i<w*h;i++){ px[o++]=u8[p]; p+=2; px[o++]=u8[p]; p+=2; px[o++]=u8[p]; p+=2; px[o++]=u8[p]; p+=2; }
    return {pages:[{w:w,h:h,rgba:px}], meta:{bitDepth:16,channels:4,colorType:"RGBA",alpha:true,compression:"None"}};
  }

  function decodePNM(u8){
    if(u8[0]!=0x50) throw new Error("Not a PNM file");
    var type=u8[1]-0x30, pos=2;
    function skip(){ for(;;){ while(pos<u8.length&&(u8[pos]==32||u8[pos]==9||u8[pos]==10||u8[pos]==13)) pos++; if(u8[pos]==0x23){ while(pos<u8.length&&u8[pos]!=10) pos++; } else break; } }
    function tok(){ skip(); var s=""; while(pos<u8.length&&u8[pos]>32){ s+=String.fromCharCode(u8[pos++]); } return s; }
    if(type<1||type>6) throw new Error("PAM (P7) not supported");
    var w=parseInt(tok(),10), h=parseInt(tok(),10);
    var maxv=(type==1||type==4)?1:parseInt(tok(),10);
    if(!w||!h||w<0||h<0) throw new Error("Bad PNM dimensions");
    var px=new Uint8ClampedArray(w*h*4), o=0, i, sc=255/(maxv||1);
    if(type==1||type==2||type==3){
      for(i=0;i<w*h;i++){
        if(type==1){ var v=parseInt(tok(),10); var c=v?0:255; px[o++]=c;px[o++]=c;px[o++]=c;px[o++]=255; }
        else if(type==2){ var gr=Math.round(parseInt(tok(),10)*sc); px[o++]=gr;px[o++]=gr;px[o++]=gr;px[o++]=255; }
        else { px[o++]=Math.round(parseInt(tok(),10)*sc); px[o++]=Math.round(parseInt(tok(),10)*sc); px[o++]=Math.round(parseInt(tok(),10)*sc); px[o++]=255; }
      }
    } else {
      pos++; // single whitespace after header
      var wide=maxv>255;
      function rd(){ return wide?((u8[pos++]<<8)|u8[pos++]):u8[pos++]; }
      if(type==4){ var rb=Math.ceil(w/8); for(var y=0;y<h;y++){ for(var x=0;x<w;x++){ var byte=u8[pos+y*rb+(x>>3)]; var bit=(byte>>(7-(x&7)))&1; var cc=bit?0:255; px[o++]=cc;px[o++]=cc;px[o++]=cc;px[o++]=255; } } }
      else if(type==5){ for(i=0;i<w*h;i++){ var g2=Math.round(rd()*sc); px[o++]=g2;px[o++]=g2;px[o++]=g2;px[o++]=255; } }
      else { for(i=0;i<w*h;i++){ px[o++]=Math.round(rd()*sc); px[o++]=Math.round(rd()*sc); px[o++]=Math.round(rd()*sc); px[o++]=255; } }
    }
    var ctype=(type==1||type==4)?"Bitmap (1-bit)":(type==2||type==5)?"Grayscale":"RGB";
    return {pages:[{w:w,h:h,rgba:px}], meta:{bitDepth:(type==1||type==4)?1:(maxv>255?16:8),colorType:ctype,alpha:false,compression:"None (raw)"}};
  }

  function decodeTGA(u8){
    var idLen=u8[0], cmType=u8[1], imgType=u8[2];
    var _cmFirst=u8[3]|(u8[4]<<8), cmLen=u8[5]|(u8[6]<<8), cmDepth=u8[7];
    var w=u8[12]|(u8[13]<<8), h=u8[14]|(u8[15]<<8), pxDepth=u8[16], desc=u8[17];
    if(!w||!h||w>32768||h>32768) throw new Error("Bad TGA dimensions");
    var topLeft=(desc&0x20)!=0;
    var p=18+idLen;
    var cmap=null, cmapBpp=cmDepth>>3;
    if(cmType==1){ cmap=u8.subarray(p, p+cmLen*cmapBpp); p+=cmLen*cmapBpp; }
    var rle=imgType>=9;
    var baseType=imgType&7; // 1 cmap, 2 rgb, 3 gray
    var bpp=pxDepth>>3, n=w*h;
    var raw=new Uint8Array(n*bpp), ri=0;
    if(!rle){ raw.set(u8.subarray(p, p+n*bpp)); }
    else {
      var pixels=0;
      while(pixels<n && p<u8.length){
        var pkt=u8[p++]; var count=(pkt&0x7f)+1;
        if(pkt&0x80){ for(var c=0;c<count;c++){ for(var bI=0;bI<bpp;bI++) raw[ri+bI]=u8[p+bI]; ri+=bpp; } p+=bpp; }
        else { for(var k=0;k<count*bpp;k++) raw[ri++]=u8[p++]; }
        pixels+=count;
      }
    }
    var px=new Uint8ClampedArray(n*4);
    function put(o,r,g,b,a){ px[o]=r;px[o+1]=g;px[o+2]=b;px[o+3]=a; }
    function sample(i){
      var off=i*bpp, r,g,b,a=255;
      if(baseType==1){ // color-mapped: index into palette
        var idx=bpp==2?(raw[off]|(raw[off+1]<<8)):raw[off]; var co=(idx)*cmapBpp;
        if(cmapBpp==2){ var v=cmap[co]|(cmap[co+1]<<8); r=((v>>10)&31)*255/31|0; g=((v>>5)&31)*255/31|0; b=(v&31)*255/31|0; a=(v&0x8000)?255:255; }
        else if(cmapBpp==3){ b=cmap[co]; g=cmap[co+1]; r=cmap[co+2]; }
        else { b=cmap[co]; g=cmap[co+1]; r=cmap[co+2]; a=cmap[co+3]; }
      } else if(baseType==3){ r=g=b=raw[off]; if(bpp==2) a=raw[off+1]; }
      else { // rgb
        if(bpp==2){ var v2=raw[off]|(raw[off+1]<<8); r=((v2>>10)&31)*255/31|0; g=((v2>>5)&31)*255/31|0; b=(v2&31)*255/31|0; a=(v2&0x8000)?255:255; }
        else if(bpp==3){ b=raw[off]; g=raw[off+1]; r=raw[off+2]; }
        else { b=raw[off]; g=raw[off+1]; r=raw[off+2]; a=raw[off+3]; }
      }
      return [r,g,b,a];
    }
    for(var y=0;y<h;y++){ var sy=topLeft?y:(h-1-y); for(var x=0;x<w;x++){ var s=sample(sy*w+x); put((y*w+x)*4, s[0],s[1],s[2],s[3]); } }
    var hasAlpha=(baseType!=3 && bpp==4)||(baseType==1&&cmapBpp==4);
    return {pages:[{w:w,h:h,rgba:px}], meta:{bitDepth:8,colorType:baseType==3?"Grayscale":baseType==1?"Indexed (palette)":"RGB"+(bpp==4?"A":""),alpha:hasAlpha,compression:rle?"RLE":"None"}};
  }

  function decodePCX(u8){
    if(u8[0]!=0x0a) throw new Error("Not a PCX file");
    var enc=u8[2], bpp=u8[3];
    var xmin=u8[4]|(u8[5]<<8), ymin=u8[6]|(u8[7]<<8), xmax=u8[8]|(u8[9]<<8), ymax=u8[10]|(u8[11]<<8);
    var w=xmax-xmin+1, h=ymax-ymin+1;
    var planes=u8[65], bpl=u8[66]|(u8[67]<<8);
    if(w<=0||h<=0||w>32768||h>32768) throw new Error("Bad PCX dimensions");
    var total=bpl*planes*h, raw=new Uint8Array(total), p=128, o=0;
    if(enc==1){ while(o<total && p<u8.length){ var b=u8[p++]; if((b&0xc0)==0xc0){ var cnt=b&0x3f; var val2=u8[p++]; for(var i=0;i<cnt&&o<total;i++) raw[o++]=val2; } else raw[o++]=b; } }
    else { raw.set(u8.subarray(p,p+total)); }
    var px=new Uint8ClampedArray(w*h*4);
    var pal256=null;
    if(bpp==8&&planes==1 && u8[u8.length-769]==0x0c){ pal256=u8.subarray(u8.length-768); }
    for(var y=0;y<h;y++){
      var row=y*bpl*planes;
      for(var x=0;x<w;x++){
        var oo=(y*w+x)*4, r,g,bb,a=255;
        if(planes==3){ r=raw[row+x]; g=raw[row+bpl+x]; bb=raw[row+2*bpl+x]; }
        else if(bpp==8&&planes==1){ var idx=raw[row+x]; if(pal256){ r=pal256[idx*3]; g=pal256[idx*3+1]; bb=pal256[idx*3+2]; } else { r=g=bb=idx; } }
        else if(bpp==1){ // 1-bit, up to 4 planes → build index
          var bit=7-(x&7), byteoff=(x>>3), ix=0;
          for(var pl=0;pl<planes;pl++){ ix|=((raw[row+pl*bpl+byteoff]>>bit)&1)<<pl; }
          var eg=egaPalette(u8, ix); r=eg[0]; g=eg[1]; bb=eg[2];
        } else { var idx2=raw[row+x]; r=g=bb=idx2; }
        px[oo]=r;px[oo+1]=g;px[oo+2]=bb;px[oo+3]=a;
      }
    }
    return {pages:[{w:w,h:h,rgba:px}], meta:{bitDepth:bpp,channels:planes,colorType:planes==3?"RGB":"Indexed (palette)",alpha:false,compression:enc==1?"RLE":"None"}};
  }
  function egaPalette(u8,i){ var o=16+i*3; return [u8[o],u8[o+1],u8[o+2]]; }

  function decodeDDS(u8){
    if(!(u8[0]==0x44&&u8[1]==0x44&&u8[2]==0x53&&u8[3]==0x20)) throw new Error("Not a DDS file");
    function u32(o){ return (u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16))+u8[o+3]*16777216; }
    var height=u32(12), width=u32(16);
    var fourCC=ascii(u8,84,4), rgbBits=u32(88), rMask=u32(92),gMask=u32(96),bMask=u32(100),aMask=u32(104);
    if(!width||!height||width>16384||height>16384) throw new Error("Bad DDS dimensions");
    var dataOff=(fourCC=="DX10")?148:128;
    var out=new Uint8ClampedArray(width*height*4);
    function setpx(x,y,r,g,b,a){ if(x<width&&y<height){ var o=(y*width+x)*4; out[o]=r;out[o+1]=g;out[o+2]=b;out[o+3]=a; } }
    if(fourCC=="DXT1"||fourCC=="DXT3"||fourCC=="DXT5"){
      var p=dataOff, bw=Math.ceil(width/4), bh=Math.ceil(height/4);
      for(var by=0;by<bh;by++){ for(var bx=0;bx<bw;bx++){
        var a3=null, a5=null;
        if(fourCC=="DXT3"){ a3=[]; for(var q=0;q<8;q++) a3.push(u8[p++]); }
        else if(fourCC=="DXT5"){ var av0=u8[p++],av1=u8[p++]; var ab=[]; for(var q2=0;q2<6;q2++) ab.push(u8[p++]); a5={a0:av0,a1:av1,bytes:ab}; }
        var c0=u8[p]|(u8[p+1]<<8), c1=u8[p+2]|(u8[p+3]<<8); p+=4;
        var lut=(u8[p]|(u8[p+1]<<8)|(u8[p+2]<<16))+u8[p+3]*16777216; p+=4;
        var col=[rgb565(c0),rgb565(c1),[0,0,0],[0,0,0]];
        if(c0>c1||fourCC!="DXT1"){ col[2]=[(2*col[0][0]+col[1][0])/3|0,(2*col[0][1]+col[1][1])/3|0,(2*col[0][2]+col[1][2])/3|0]; col[3]=[(col[0][0]+2*col[1][0])/3|0,(col[0][1]+2*col[1][1])/3|0,(col[0][2]+2*col[1][2])/3|0]; }
        else { col[2]=[(col[0][0]+col[1][0])/2|0,(col[0][1]+col[1][1])/2|0,(col[0][2]+col[1][2])/2|0]; col[3]=[0,0,0]; }
        for(var yy=0;yy<4;yy++){ for(var xx=0;xx<4;xx++){
          var pi=yy*4+xx, idx=(Math.floor(lut/Math.pow(4,pi)))&3, c=col[idx], a=255;
          if(fourCC=="DXT1"){ if(c0<=c1&&idx==3) a=0; }
          else if(fourCC=="DXT3"){ var an=a3[yy*2+(xx>>1)]; a=((xx&1)?(an>>4):(an&15))*17; }
          else if(fourCC=="DXT5"){ a=dxt5alpha(a5,pi); }
          setpx(bx*4+xx,by*4+yy,c[0],c[1],c[2],a);
        }}
      }}
      return {pages:[{w:width,h:height,rgba:out}], meta:{colorType:"DDS "+fourCC,compression:fourCC+" (BC)",bitDepth:8,alpha:fourCC!="DXT1"}};
    }
    // uncompressed
    var bytespp=Math.max(1,rgbBits>>3), pp=dataOff;
    function chan(mask){ if(!mask) return {sh:0,bits:0,max:1}; var sh=0; while(!((mask>>>sh)&1)) sh++; var m=mask>>>sh,bits=0; while(m&1){bits++;m>>>=1;} return {sh:sh,bits:bits,max:(1<<bits)-1}; }
    var R=chan(rMask),G=chan(gMask),B=chan(bMask),A=chan(aMask);
    function ex(v,c,isA){ if(!c.bits) return isA?255:0; return Math.round(((v>>>c.sh)&c.max)*255/c.max); }
    for(var y2=0;y2<height;y2++){ for(var x2=0;x2<width;x2++){ var v=0; for(var bI=0;bI<bytespp;bI++) v|=u8[pp++]<<(8*bI); var o=(y2*width+x2)*4; out[o]=ex(v,R,false); out[o+1]=ex(v,G,false); out[o+2]=ex(v,B,false); out[o+3]=aMask?ex(v,A,true):255; } }
    return {pages:[{w:width,h:height,rgba:out}], meta:{colorType:"DDS uncompressed",compression:"None",bitDepth:8,alpha:!!aMask}};
  }
  function rgb565(c){ return [((c>>11)&31)*255/31|0,((c>>5)&63)*255/63|0,(c&31)*255/31|0]; }
  function dxt5alpha(a5,i){ var al=[a5.a0,a5.a1],k; if(a5.a0>a5.a1){ for(k=1;k<=6;k++) al.push(((7-k)*a5.a0+k*a5.a1)/7|0); } else { for(k=1;k<=4;k++) al.push(((5-k)*a5.a0+k*a5.a1)/5|0); al.push(0); al.push(255); } var bits=0; for(var b=0;b<6;b++) bits+=a5.bytes[b]*Math.pow(2,8*b); var idx=Math.floor(bits/Math.pow(2,3*i))%8; return al[idx]; }

  // =====================================================================
  //  Shell: header auto-hide, nav, background color, drag & drop
  // =====================================================================
  var HDR_IDLE_MS=3000, hdrIdleTimer=null;
  function showHeader(){ body.classList.remove("hdr-hidden"); }
  function hideHeader(){ if(body.classList.contains("viewing") && !body.classList.contains("nav-open") && !body.classList.contains("info-open")) body.classList.add("hdr-hidden"); }
  function armIdleHide(){ clearTimeout(hdrIdleTimer); hdrIdleTimer=setTimeout(hideHeader,HDR_IDLE_MS); }
  function revealHeader(){ showHeader(); armIdleHide(); }
  hoverZone.addEventListener("mouseenter", revealHeader);
  hoverZone.addEventListener("click", revealHeader);
  hoverZone.addEventListener("touchstart", function(){ revealHeader(); }, {passive:true});
  topbar.addEventListener("mouseenter", function(){ showHeader(); clearTimeout(hdrIdleTimer); });
  topbar.addEventListener("mouseleave", function(){ armIdleHide(); });
  function measureHeader(){ root.style.setProperty("--hdr-h",(topbar?topbar.offsetHeight:56)+"px"); }
  measureHeader(); window.addEventListener("resize", measureHeader);

  var btnMenu=id("btnMenu"), navBackdrop=id("navBackdrop");
  function setNav(open){ body.classList.toggle("nav-open",open); btnMenu.setAttribute("aria-expanded",open?"true":"false"); if(open) showHeader(); }
  btnMenu.addEventListener("click", function(){ setNav(!body.classList.contains("nav-open")); });
  navBackdrop.addEventListener("click", function(){ setNav(false); });
  doc.addEventListener("keydown", function(e){ if(e.key==="Escape") setNav(false); });

  function setCookie(n,v){ doc.cookie=n+"="+encodeURIComponent(v)+"; max-age=31536000; path=/; SameSite=Lax"; }
  function getCookie(n){ var m=doc.cookie.match("(?:^|; )"+n.replace(/([.*+?^${}()|[\]\\])/g,"\\$1")+"=([^;]*)"); return m?decodeURIComponent(m[1]):null; }
  function hexToRgb(h){ h=h.replace("#",""); if(h.length===3) h=h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2); var n=parseInt(h,16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
  function srgb(c){ c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); }
  function luminance(rgb){ return 0.2126*srgb(rgb.r)+0.7152*srgb(rgb.g)+0.0722*srgb(rgb.b); }
  function mix(a,b,t){ return "rgb("+Math.round(a.r+(b.r-a.r)*t)+","+Math.round(a.g+(b.g-a.g)*t)+","+Math.round(a.b+(b.b-a.b)*t)+")"; }
  function rgbStr(c){ return "rgb("+c.r+","+c.g+","+c.b+")"; }
  function applyColor(hex){
    if(!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) hex="#ffffff";
    var bg=hexToRgb(hex), lightText=luminance(bg)<=0.179;
    var text=lightText?{r:240,g:243,b:246}:{r:31,g:35,b:40};
    var accentHex=lightText?"#8b93ff":"#4f46e5", ac=hexToRgb(accentHex), s=root.style;
    s.setProperty("--bg",hex); s.setProperty("--surface",hex);
    s.setProperty("--text",rgbStr(text));
    s.setProperty("--muted",mix(bg,text,0.45)); s.setProperty("--border",mix(bg,text,0.24));
    s.setProperty("--border-soft",mix(bg,text,0.13)); s.setProperty("--code-bg",mix(bg,text,0.07));
    s.setProperty("--hover",mix(bg,text,0.10)); s.setProperty("--accent",accentHex);
    s.setProperty("--accent-contrast",lightText?"#0d1117":"#ffffff");
    s.setProperty("--overlay","rgba("+ac.r+","+ac.g+","+ac.b+",0.12)");
    s.setProperty("--shadow",lightText?"rgba(0,0,0,0.6)":"rgba(0,0,0,0.12)");
    s.setProperty("--header-bg","rgba("+bg.r+","+bg.g+","+bg.b+",0.9)");
    root.style.colorScheme=lightText?"dark":"light";
    themeColor.setAttribute("content",hex);
  }
  function isHex6(v){ return /^#([0-9a-f]{6})$/i.test(v||""); }
  function saveColor(v){ setCookie("mykk-bg",v); try{ localStorage.setItem("mykk-bg",v); }catch(e){} }
  function loadColor(){ var v=getCookie("mykk-bg"); if(!isHex6(v)){ try{ v=localStorage.getItem("mykk-bg"); }catch(e){ v=null; } } return isHex6(v)?v:((window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "#0d1117" : "#ffffff"); }
  var saved=loadColor(); bgPicker.value=saved; applyColor(saved);
  bgPicker.addEventListener("input", function(){ applyColor(bgPicker.value); saveColor(bgPicker.value); syncThemeToggle(); });
  var themeToggle=document.getElementById("themeToggle"),themeIconSun=document.getElementById("themeIconSun"),themeIconMoon=document.getElementById("themeIconMoon");
  function isDarkBg(){ try { return luminance(hexToRgb(bgPicker.value)) <= 0.179; } catch(e){ return false; } }
  function syncThemeToggle(){ if(!themeToggle) return; var dark=isDarkBg(); themeToggle.setAttribute("aria-pressed", dark?"true":"false"); themeToggle.setAttribute("aria-label", dark?"Switch to light theme":"Switch to dark theme"); if(themeIconSun){ if(dark) themeIconSun.setAttribute("hidden",""); else themeIconSun.removeAttribute("hidden"); } if(themeIconMoon){ if(dark) themeIconMoon.removeAttribute("hidden"); else themeIconMoon.setAttribute("hidden",""); } }
  if(themeToggle){ themeToggle.addEventListener("click", function(){ var next=isDarkBg()?"#ffffff":"#0d1117"; bgPicker.value=next; applyColor(next); saveColor(next); syncThemeToggle(); }); }
  syncThemeToggle();

  var dragDepth=0;
  function showOverlay(s){ overlay.classList.toggle("show",s); }
  window.addEventListener("dragenter", function(e){ if(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types||[],"Files")===-1) return; e.preventDefault(); dragDepth++; showOverlay(true); });
  window.addEventListener("dragover", function(e){ e.preventDefault(); if(e.dataTransfer) e.dataTransfer.dropEffect="copy"; });
  window.addEventListener("dragleave", function(e){ e.preventDefault(); dragDepth--; if(dragDepth<=0){ dragDepth=0; showOverlay(false); } });
  window.addEventListener("drop", function(e){ e.preventDefault(); dragDepth=0; showOverlay(false); var dt=e.dataTransfer; if(dt&&dt.files&&dt.files.length) readFile(dt.files[0]); });
  window.addEventListener("paste", function(e){ var cd=e.clipboardData||window.clipboardData; if(cd&&cd.files&&cd.files.length){ e.preventDefault(); readFile(cd.files[0]); } });
})();
