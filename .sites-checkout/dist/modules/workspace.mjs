const valid=['capture','reconstruct','walk'];
const buttons=[...document.querySelectorAll('[data-step]')];
const panels=[...document.querySelectorAll('[data-panel]')];
function selectStep(step,{updateUrl=true}={}){
  if(!valid.includes(step))step='capture';
  for(const panel of panels)panel.hidden=panel.dataset.panel!==step;
  for(const button of buttons){if(button.dataset.step===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current')}
  if(updateUrl)history.replaceState(null,'',`#${step}`);
  window.dispatchEvent(new CustomEvent('spatial-step',{detail:step}));
}
for(const button of buttons)button.addEventListener('click',()=>selectStep(button.dataset.step));
for(const button of document.querySelectorAll('[data-go]'))button.addEventListener('click',()=>{selectStep(button.dataset.go);document.querySelector('.step-nav')?.scrollIntoView({behavior:'smooth',block:'start'})});
window.addEventListener('hashchange',()=>selectStep(location.hash.slice(1),{updateUrl:false}));
const count=document.getElementById('photoCount');
function updateCount(){for(const element of document.querySelectorAll('[data-frame-count]'))element.textContent=count.textContent}
new MutationObserver(updateCount).observe(count,{childList:true,characterData:true,subtree:true});updateCount();
selectStep(location.hash.slice(1),{updateUrl:false});
