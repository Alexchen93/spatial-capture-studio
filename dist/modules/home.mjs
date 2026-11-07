const note=document.querySelector('.stage-note');
if(note){
  const marker=document.createElement('span');marker.setAttribute('aria-hidden','true');marker.textContent='●';
  const link=document.createElement('a');link.href='./personal-walk.html';link.textContent='開啟個人校正工具 →';
  note.replaceChildren(marker,document.createTextNode(' 個人場景可在本機校正頁載入；尺度、地板和碰撞仍須人工設定。 '),link);
}
