const valid=['capture','reconstruct','walk'];
const buttons=[...document.querySelectorAll('[data-step]')];
const panels=[...document.querySelectorAll('[data-panel]')];
function selectStep(step,{updateUrl=true}={}){
  if(!valid.includes(step))step='capture';
  for(const panel of panels)panel.hidden=panel.dataset.panel!==step;
  for(const button of buttons){if(button.dataset.step===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current')}
  if(updateUrl)history.replaceState(null,'',`#${step}`);
}
for(const button of buttons)button.addEventListener('click',()=>selectStep(button.dataset.step));
for(const button of document.querySelectorAll('[data-go]'))button.addEventListener('click',()=>{selectStep(button.dataset.go);document.querySelector('.step-nav')?.scrollIntoView({behavior:'smooth',block:'start'})});
const walkIntro=document.querySelector('.walk-intro');
const walkCopy=walkIntro?.querySelector('p');
if(walkCopy)walkCopy.textContent='下方是固定的碰撞示範。個人重建結果可在「個人場景校正」載入；尺度、地板和碰撞區仍須依現場人工校正。';
const backToReconstruction=walkIntro?.querySelector('[data-go="reconstruct"]');
if(backToReconstruction&&!walkIntro.querySelector('.walk-intro-actions')){
  const actions=document.createElement('div');actions.className='walk-intro-actions';
  const entry=document.createElement('a');entry.className='personal-walk-cta';entry.href='./personal-walk.html';entry.append(document.createTextNode('開啟個人場景校正 '));
  const arrow=document.createElement('span');arrow.setAttribute('aria-hidden','true');arrow.textContent='→';entry.append(arrow);
  const hint=document.createElement('small');hint.textContent='載入已儲存場景或匯入 PLY，手動校正碰撞。';
  backToReconstruction.before(actions);actions.append(entry,hint,backToReconstruction);
}
const personalPreviewCaption=document.getElementById('personalPreviewCaption');
if(personalPreviewCaption)personalPreviewCaption.textContent='這是本次重建的視覺預覽；完成後可儲存為個人場景，再手動校正尺度、地板與碰撞區。';
window.addEventListener('hashchange',()=>selectStep(location.hash.slice(1),{updateUrl:false}));
const count=document.getElementById('photoCount');
function updateCount(){for(const element of document.querySelectorAll('[data-frame-count]'))element.textContent=count.textContent}
new MutationObserver(updateCount).observe(count,{childList:true,characterData:true,subtree:true});updateCount();
selectStep(location.hash.slice(1),{updateUrl:false});
