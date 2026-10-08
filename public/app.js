const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  hash: '<path d="M4 9h16M3 15h16M10 3 6 21M18 3l-4 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  logout: '<path d="M9 21H4V3h5m5 14 5-5-5-5m-6 5h13"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-2l1 2M4 17l1 2a8 8 0 0 0 14-2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  message: '<path d="M21 15a3 3 0 0 1-3 3H7l-5 4V5a3 3 0 0 1 3-3h13a3 3 0 0 1 3 3v10Z"/><path d="M7 7h10M7 12h7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  volume: '<path d="m11 4-5 4H2v8h4l5 4V4Zm4 4a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.shield}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const titles = { overview:'Overview', members:'Members', channels:'Channels & roles', logs:'Activity log', reset:'Reset server', keys:'Access keys' };
const actionNames = { warn:'Warn member', timeout:'Timeout member', untimeout:'Remove timeout', kick:'Kick member', ban:'Ban member', unban:'Unban member', purge:'Clear messages' };
let session = null, data = null, page = 'overview', plan = null, currentJob = null, pollTimer = null, toastTimer = null;

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials:'same-origin', ...options, headers:{ 'Content-Type':'application/json', ...(session?.csrf ? { 'X-CSRF-Token':session.csrf } : {}), ...options.headers } });
  const result = await response.json();
  if (response.status === 401 && path !== '/login') { signOutUI(); throw new Error('Your session ended. Sign in again.'); }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed');
  return result;
}
const post = (path, body) => api(path, { method:'POST', body:JSON.stringify(body) });
function toast(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.toggle('error', error); $('#toast').hidden = false;
  toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 9000 : 5500);
}
function signOutUI() {
  session = null; data = null; plan = null; currentJob = null; clearTimeout(pollTimer);
  clearTimeout(toastTimer); $('#toast').hidden = true;
  $('#sidebar').classList.remove('open'); $('#mobile-menu').setAttribute('aria-expanded','false');
  $('#dashboard').hidden = true; $('#login').hidden = false; $('#access-key').value = '';
  if ($('#modal').open) $('#modal').close();
}
function initials(name) { return name.split(/\s+/).slice(0,2).map(n => n[0] || '').join('').toUpperCase(); }
function avatar(member) {
  // Only trusted Discord CDN avatar URLs are accepted; text is escaped everywhere.
  if (member.avatar && /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(member.avatar)) return `<img class="avatar" src="${escape(member.avatar)}" alt="" loading="lazy">`;
  return `<div class="avatar purple">${escape(initials(member.name))}</div>`;
}
function relative(time) {
  const seconds = Math.max(0, Math.floor((Date.now() - time)/1000));
  return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds/60)}m ago` : seconds < 86400 ? `${Math.floor(seconds/3600)}h ago` : `${Math.floor(seconds/86400)}d ago`;
}
const date = time => new Date(time).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' });
const labelAction = action => action.replaceAll('-', ' ').replace(/^./, c => c.toUpperCase());
const actorLabel = actor => actor.replace(/ \([\da-f-]+\)$/, '');
function heading(title, description, button = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${button}</div>`; }
function panel(title, subtitle, body, button = '', footer = '') { return `<section class="panel"><div class="panel-header"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${button}</div>${body}${footer ? `<div class="panel-footer">${footer}</div>` : ''}</section>`; }
function stat(title, value, foot, name, color = '') { return `<div class="stat"><div class="stat-head">${title}<span class="stat-icon ${color}">${icon(name)}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`; }

async function enter() {
  $('#login').hidden = true; $('#dashboard').hidden = false;
  $('#actor-name').textContent = session.actor.label; $('#actor-role').textContent = session.actor.owner ? 'Owner access' : 'Moderator access';
  $('#profile-avatar').textContent = $('#top-avatar').textContent = initials(session.actor.label);
  $('#keys-nav').hidden = !session.actor.owner;
  $('#mode-badge').textContent = session.demo ? 'DEMO MODE' : 'LIVE SERVER';
  $('#mode-badge').className = `badge ${session.demo ? 'purple-badge' : 'green-badge'}`;
  $('#mode-card').innerHTML = `<span class="live-dot"></span><div><strong>${session.demo ? 'Demo workspace' : 'Bot connected'}</strong><span>${session.demo ? 'No real Discord actions' : 'Discord actions are live'}</span></div><span>${icon('shield')}</span>`;
  $('#content').innerHTML = '<div class="loading">Connecting to your workspace…</div>';
  await refresh();
}
async function refresh() {
  const button = $('#refresh'); button.disabled = true;
  try {
    data = await api('/overview');
    $('#server-name').textContent = data.guild.name; $('#server-avatar').textContent = initials(data.guild.name).slice(0,1);
    $('#nav-count').textContent = data.guild.members.length; $('#refresh-time').textContent = `Updated ${new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`;
    const running = data.jobs.find(j => j.status === 'running' || j.status === 'queued');
    if (running) { currentJob = running; schedulePoll(); }
    render();
  } catch (error) {
    if (session) $('#content').innerHTML = `<div class="error-panel"><h2>Couldn’t load your server</h2><p>${escape(error.message)}</p><button class="button" data-command="refresh">Try again</button></div>`;
    throw error;
  } finally { button.disabled = false; }
}
function navigate(next) {
  page = next; if (page !== 'reset') plan = null;
  $('#sidebar').classList.remove('open'); $('#mobile-menu').setAttribute('aria-expanded','false');
  render(); $('#content').focus();
}
function render() {
  if (!data) return;
  $('#breadcrumb-page').textContent = titles[page];
  document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'overview') renderOverview();
  else if (page === 'members') renderMembers();
  else if (page === 'channels') renderChannels();
  else if (page === 'logs') renderLogs();
  else if (page === 'reset') renderReset();
  else if (page === 'keys') void renderKeys();
}
function memberTable(members, full = false) {
  if (!members.length) return '<div class="empty">No members match your search.</div>';
  return `<div class="table-scroll"><table><thead><tr><th>MEMBER</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${members.map(m => `<tr><td><div class="member-cell">${avatar(m)}<div><strong>${escape(m.name)}</strong><small>${escape(m.id)}</small></div></div></td><td>${m.bot ? '<span class="badge purple-badge">BOT</span>' : m.id === data.guild.ownerId ? '<span class="badge amber-badge">OWNER</span>' : m.timedOut ? '<span class="badge amber-badge">TIMED OUT</span>' : '<span class="badge green-badge">MEMBER</span>'}</td><td><div class="cell-actions"><button class="button small" data-command="member" data-id="${escape(m.id)}">${full ? 'Manage' : 'Moderate'}</button>${full ? `<button class="icon-button" data-command="warnings" data-id="${escape(m.id)}" title="Warning history" aria-label="Warning history for ${escape(m.name)}">${icon('clock')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
}
function activity(logs) {
  if (!logs.length) return '<div class="empty">A clean slate.<br>Moderation actions will appear here.</div>';
  return `<div class="activity-list">${logs.map(log => `<div class="activity-item"><div class="activity-icon ${log.status === 'failed' ? 'failed' : ''}">${icon(log.action.includes('ban') ? 'ban' : log.action.includes('key') ? 'key' : log.action.includes('reset') ? 'reset' : log.action === 'warn' ? 'alert' : 'shield')}</div><div class="activity-copy"><strong>${escape(labelAction(log.action))}${log.status === 'failed' ? ' · failed' : ''}</strong><p>${escape(actorLabel(log.actor))} · ${escape(log.reason)}</p><time title="${escape(date(log.time))}">${relative(log.time)}</time></div></div>`).join('')}</div>`;
}
function renderOverview() {
  const g = data.guild;
  const moderation = data.logs.filter(l => ['warn','timeout','untimeout','kick','ban','unban','purge'].includes(l.action));
  const today = moderation.filter(l => l.time >= new Date().setHours(0,0,0,0)).length;
  $('#content').innerHTML = heading('Your community, at a glance.', 'Keep things running smoothly. You’re in control.', `<button class="button" data-command="moderate">${icon('plus')} Quick action</button>`) +
    `<section class="hero"><div><div class="eyebrow">${icon('shield')} THE CONTROL ROOM</div><h2>A good community starts with good care.</h2><p>Manage members, keep conversations on track, and make the calls that keep ${escape(g.name)} a place people want to be.</p></div><div class="hero-art">${icon('shield')}</div><span class="badge purple-badge hero-badge">${session.demo ? 'SAFE DEMO' : 'PRIVATE WORKSPACE'}</span></section>` +
    `<div class="stats">${stat('Server members',g.members.length,`${g.members.filter(m=>!m.bot).length} people · ${g.members.filter(m=>m.bot).length} bots`,'users')}${stat('Channels',g.channels.length,`${g.channels.filter(c=>c.text).length} text channels`,'hash')}${stat('Moderation today',today,'Actions in the recent activity log','shield','green')}${stat('Active timeouts',g.members.filter(m=>m.timedOut).length,'Current member restrictions','clock','amber')}</div>` +
    `<div class="content-grid">${panel('Community members','A few familiar faces in your server',memberTable(g.members.slice(0,5)),`<button class="button ghost small" data-command="navigate" data-page-target="members">View all ${icon('arrow')}</button>`,`<span>${g.members.length} members in this workspace</span><span>${session.demo ? 'Simulated server data' : 'Connected to Discord'}</span>`)}${panel('Recent activity','The latest from your moderation team',activity(data.logs.slice(0,5)),`<button class="icon-button" data-command="navigate" data-page-target="logs" aria-label="View full activity log">${icon('arrow')}</button>`,`<span>Every dashboard action leaves a trail</span>`)}</div>`;
}
function renderMembers() {
  $('#content').innerHTML = heading('Your people.', 'Find a member, take action, and keep your community moving.', `<button class="button" data-command="unban">${icon('ban')} Unban member</button>`) + panel('Member directory',`${data.guild.members.length} members in ${escape(data.guild.name)}`,`<div id="member-table">${memberTable(data.guild.members,true)}</div>`,`<div class="search">${icon('search')}<input id="member-search" aria-label="Search members" placeholder="Search name or Discord ID…"></div>`,`<span>Protected members follow Discord’s role hierarchy.</span>`);
  $('#member-search').addEventListener('input', e => { const q = e.target.value.toLowerCase(); $('#member-table').innerHTML = memberTable(data.guild.members.filter(m => m.name.toLowerCase().includes(q) || m.id.includes(q)),true); });
}
function renderChannels() {
  const g = data.guild;
  $('#content').innerHTML = heading('The shape of your server.', 'Your conversations, spaces, and community roles.') + `<div class="content-grid">${panel('Channels',`${g.channels.length} spaces for your community`,g.channels.length ? `<ul class="channel-list">${g.channels.map(c=>`<li><span class="channel-label">${icon(c.text ? 'hash' : 'volume')}${escape(c.name)}</span>${c.text ? `<button class="button small" data-command="purge" data-id="${escape(c.id)}">Clear messages</button>` : `<span class="badge muted-badge">${escape(c.type.replace('Guild',''))}</span>`}</li>`).join('')}</ul>` : '<div class="empty">No channels remain in this server.</div>')}${panel('Roles',`${g.roles.length} roles and permission groups`,`<ul class="channel-list">${g.roles.map(r=>`<li><span class="channel-label"><span class="role-dot"></span>${escape(r.name)}</span>${r.editable ? '<span class="badge purple-badge">EDITABLE</span>' : `<span class="lock-text" title="${escape(r.protectedReason)}">Protected</span>`}</li>`).join('')}</ul>`)}</div>`;
}
function renderLogs() {
  $('#content').innerHTML = heading('Every action, accounted for.', 'A shared record of who did what, when, and why.') + panel('Moderation & access log','The most recent 200 events',data.logs.length ? `<div class="table-scroll"><table class="logs-table"><thead><tr><th>ACTION</th><th>PERFORMED BY</th><th>DETAILS</th><th>STATUS</th></tr></thead><tbody>${data.logs.map(l=>`<tr><td>${escape(labelAction(l.action))}<small>${escape(date(l.time))}</small></td><td>${escape(actorLabel(l.actor))}</td><td class="reason-cell">${escape(l.reason)}<small>Target: ${escape(l.target)}</small></td><td><span class="badge ${l.status === 'failed' ? 'red-badge' : 'green-badge'}">${escape(l.status.toUpperCase())}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No activity yet.</div>');
}
function protectionPanel() {
  return panel('What stays protected','Discord’s rules always apply',`<div class="panel-body"><ul class="protection-list">${['The server owner','This bot and the roles it needs','@everyone and managed roles','Members and roles above the bot','Anything the bot lacks permission to change'].map(t=>`<li>${icon('check')}${t}</li>`).join('')}</ul><p class="field-note mt">A reset has no automatic undo. It targets only the items in your preview; anything created afterward is left alone.</p></div>`);
}
function renderReset() {
  const g = data.guild;
  let body;
  if (currentJob) {
    const j = currentJob, done = !['queued','running'].includes(j.status);
    body = panel(done ? 'Reset results' : 'Reset in progress',`Started by ${escape(j.actor)} · ${escape(date(j.createdAt))}`,`<div class="panel-body"><div class="inline-gap"><span class="badge ${j.status === 'interrupted' ? 'amber-badge' : done ? 'green-badge' : 'purple-badge'}">${escape(j.status.toUpperCase())}</span><span class="field-note">${j.processed} of ${j.total} operations processed</span></div><div class="progress-track"><progress value="${j.processed}" max="${j.total}">Reset progress</progress></div><div class="job-summary"><span>${j.succeeded} completed</span><span>${j.failed} failed</span></div>${j.status === 'interrupted' ? '<div class="notice mt"><p>The process stopped before finishing. Completed actions were not rolled back. Refresh and make a new preview for remaining targets.</p></div>' : ''}<div class="job-results">${j.results.map(r=>`<div class="job-result"><span class="badge ${r.ok?'green-badge':'red-badge'}">${r.ok?'DONE':'FAILED'}</span> ${escape(r.name)} <span class="lock-text">· ${escape(r.kind)}</span>${r.error?`<p>${escape(r.error)}</p>`:''}</div>`).join('')}</div>${done ? '<button class="button full mt" data-command="reset-new">Back to reset setup</button>' : '<p class="field-note mt">Progress updates automatically. Closing this page will not stop the reset.</p>'}</div>`);
  } else if (plan) {
    const count = kind => plan.items.filter(i=>i.kind===kind).length;
    body = panel('Review your reset','This preview expires in five minutes.',`<div class="panel-body"><p class="description">You’re about to change <strong>${escape(plan.guildName)}</strong>. Review the targets, then confirm below.</p><div class="preview-numbers">${[['member','Bans'],['role','Role deletions'],['channel','Channel deletions']].map(([k,label])=>`<div class="preview-number"><strong>${count(k)}</strong><span>${label}</span></div>`).join('')}</div><div class="subheading">${plan.items.length} TARGETS</div><div class="preview-targets">${plan.items.map(i=>`<div>${escape(i.name)}<span>${escape(i.kind)}</span></div>`).join('') || '<div>No eligible targets</div>'}</div><div class="subheading">${plan.skipped.length} PROTECTED ITEMS</div><div class="preview-targets">${plan.skipped.map(i=>`<div>${escape(i.name)}<span>${escape(i.reason)}</span></div>`).join('') || '<div>None</div>'}</div><form id="reset-confirm"><div class="field"><label for="guild-confirm">Type the server name exactly</label><input id="guild-confirm" name="guildName" required autocomplete="off" placeholder="${escape(plan.guildName)}"></div><div class="field"><label for="phrase-confirm">Type RESET SERVER to confirm</label><input id="phrase-confirm" name="confirmation" required autocomplete="off" placeholder="RESET SERVER"></div><p class="form-error" id="reset-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-command="reset-back">Go back</button><button class="button danger" type="submit" ${!plan.items.length?'disabled':''}>${icon('reset')} ${session.demo?'Run demo reset':'Reset server'}</button></div></form></div>`);
  } else {
    body = panel('Choose what to reset','Only selected operations will be included.',`<form id="reset-preview" class="panel-body">${[['members','Ban all eligible members','Remove members by banning them. The server owner and this bot stay.',g.members.filter(m=>m.bannable).length],['roles','Delete all eligible roles','Remove editable roles. Managed roles and roles used by this bot stay.',g.roles.filter(r=>r.editable).length],['channels','Delete all eligible channels','Remove channels and categories the bot has permission to delete.',g.channels.filter(c=>c.deletable).length]].map(([key,title,desc,count])=>`<div class="reset-option"><input type="checkbox" id="reset-${key}" name="${key}" checked><div><label for="reset-${key}">${title}</label><p>${desc}</p></div><span class="option-count">${count}</span></div>`).join('')}<p id="reset-error" class="form-error" role="alert"></p><button class="button danger full" type="submit">${icon('search')} Preview reset</button><p class="kbd-note">Previewing does not change anything in Discord.</p></form>`);
  }
  $('#content').innerHTML = heading('A fresh start. A serious decision.', 'Plan a reset, review its impact, and confirm every step.') + `<div class="notice danger-notice">${icon('alert')}<div><strong>${session.demo ? 'You’re in demo mode. Nothing will happen to a real server.' : 'These actions permanently change your Discord server.'}</strong><p>Every valid dashboard key can run a reset. Deleted channels and roles cannot be restored by this dashboard. Banned members will need to be unbanned and reinvited.</p></div></div><div class="reset-grid">${body}${protectionPanel()}</div>`;
  $('#reset-preview')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.target;
    await submit(form, async()=>{ plan = await post('/reset/preview',Object.fromEntries(['members','roles','channels'].map(k=>[k,form.elements[k].checked]))); renderReset(); },'#reset-error');
  });
  $('#reset-confirm')?.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.target;
    await submit(form,async()=>{ currentJob = await post('/reset/execute',{planId:plan.id,guildName:form.elements.guildName.value,confirmation:form.elements.confirmation.value}); plan=null; renderReset(); schedulePoll(); },'#reset-error');
  });
}
async function renderKeys() {
  if (!session.actor.owner) { navigate('overview'); return; }
  $('#content').innerHTML = heading('A private door to your dashboard.', 'Create a key for each trusted person. Revoke access whenever you need.', `<button class="button primary" data-command="key-new">${icon('plus')} Generate key</button>`) + '<div class="notice">'+icon('key')+'<div><strong>A key grants full moderation and reset access.</strong><p>Use a separate key per person and share it privately. Activity is attributed to the key’s label, not a verified Discord identity. Only owner keys can manage access.</p></div></div><div id="key-list" class="loading">Loading access keys…</div>';
  try {
    const keys = await api('/keys'); if (page !== 'keys') return;
    $('#key-list').outerHTML = panel('Access keys',`${keys.filter(k=>!k.revoked && (!k.expires || k.expires>Date.now())).length} active keys`,`<div class="table-scroll"><table class="keys-table"><thead><tr><th>KEY LABEL</th><th>ACCESS</th><th>EXPIRES</th><th>STATUS</th><th></th></tr></thead><tbody>${keys.map(k=>`<tr><td>${escape(k.label)}<small class="field-note">Created ${escape(date(k.created))}</small></td><td><span class="badge ${k.owner?'purple-badge':'muted-badge'}">${k.owner?'OWNER':'MODERATOR'}</span></td><td>${k.expires?escape(date(k.expires)):'Never'}</td><td><span class="badge ${k.revoked||k.expires&&k.expires<Date.now()?'muted-badge':'green-badge'}">${k.revoked?'REVOKED':k.expires&&k.expires<Date.now()?'EXPIRED':'ACTIVE'}</span></td><td>${!k.owner&&!k.revoked?`<button class="button danger small" data-command="key-revoke" data-id="${escape(k.id)}">Revoke</button>`:''}</td></tr>`).join('')}</tbody></table></div>`,'','<span>Key values are shown once and stored only as hashes.</span>');
  } catch (error) { toast(error.message,true); }
}
function openModal(title, body) { $('#modal-title').textContent=title; $('#modal-body').innerHTML=body; if(!$('#modal').open) $('#modal').showModal(); }
async function submit(form, work, errorSelector='#modal-error') {
  const button=form.querySelector('[type="submit"]'); if(button.disabled) return;
  button.disabled=true; const error = $(errorSelector); if(error) error.textContent='';
  try { await work(); } catch(e) { if($(errorSelector)) $(errorSelector).textContent=e.message; else toast(e.message,true); }
  finally { button.disabled=false; }
}
function moderationModal(memberId='', initialAction='warn', channelId='') {
  const g=data.guild, member=g.members.find(m=>m.id===memberId);
  const actions=channelId?['purge']:initialAction==='unban'?['unban']:['warn','timeout','untimeout','kick','ban'];
  openModal(channelId?'Clear channel messages':member?`Manage ${member.name}`:initialAction==='unban'?'Unban member':'Quick moderation action',`<form id="moderation-form">${member?.protectedReason?`<p class="description">${escape(member.protectedReason)}. Only eligible actions can be applied.</p>`:''}<div class="field"><label for="mod-action">Action</label><select id="mod-action" name="action">${actions.map(a=>`<option value="${a}" ${a===initialAction?'selected':''}>${actionNames[a]}</option>`).join('')}</select></div><div class="field"><label for="mod-target">${channelId?'Channel':initialAction==='unban'?'Banned member’s Discord ID':'Member'}</label>${initialAction==='unban'?'<input id="mod-target" name="target" inputmode="numeric" pattern="[0-9]{17,20}" placeholder="17–20 digit Discord ID" required>':`<select id="mod-target" name="target">${(channelId?g.channels.filter(c=>c.text):g.members).map(m=>`<option value="${escape(m.id)}" ${m.id===(channelId||memberId)?'selected':''}>${escape(m.name)}</option>`).join('')}</select>`}</div><div id="amount-field" class="field" ${['purge','timeout'].includes(initialAction)?'':'hidden'}><label id="amount-label" for="mod-amount">${channelId?'Messages to delete (1–100)':'Timeout duration (minutes)'}</label><input id="mod-amount" name="amount" type="number" min="1" max="${channelId?'100':'40320'}" value="${channelId?'20':'60'}"></div><div class="field"><label for="mod-reason">Reason</label><textarea id="mod-reason" name="reason" rows="3" minlength="3" maxlength="300" placeholder="Give your team a little context…" required></textarea><p class="field-note">${channelId?'Messages older than 14 days are skipped.':'Warnings are recorded in this dashboard; they do not send a DM.'}</p></div><p id="modal-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-command="modal-close">Cancel</button><button class="button primary" type="submit">Apply action ${icon('arrow')}</button></div></form>`);
  $('#mod-action').addEventListener('change',e=>{
    const action=e.target.value;
    $('#amount-field').hidden=!['timeout','purge'].includes(action);
    const target = g.members.find(m=>m.id===$('#mod-target').value);
    $('#modal-error').textContent=target && ((action==='ban'&&!target.bannable)||(action==='kick'&&!target.kickable)||(['timeout','untimeout'].includes(action)&&!target.moderatable))?'Discord will not allow this action on this member.':'';
  });
  $('#moderation-form').addEventListener('submit',async e=>{
    e.preventDefault(); const form=e.target;
    await submit(form,async()=>{
      const action=form.elements.action.value;
      const result=await post('/moderate',{ action,target:form.elements.target.value,reason:form.elements.reason.value,...(['timeout','purge'].includes(action)?{amount:Number(form.elements.amount.value)}:{}) });
      $('#modal').close(); toast(result.message); await refresh();
    });
  });
}
function newKey() {
  openModal('Invite someone you trust',`<form id="key-form"><p class="description">This key grants moderation and server reset access. Choose a label that identifies the person using it.</p><div class="field"><label for="key-label">Key label</label><input id="key-label" name="label" placeholder="e.g. Sophie · moderation team" minlength="2" maxlength="60" required></div><div class="field"><label for="key-days">Expires in</label><select id="key-days" name="days"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></div><p id="modal-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-command="modal-close">Cancel</button><button class="button primary" type="submit">${icon('key')} Generate access key</button></div></form>`);
  $('#key-form').addEventListener('submit',async e=>{
    e.preventDefault(); const form=e.target;
    await submit(form,async()=>{
      const result=await post('/keys',{label:form.elements.label.value,days:Number(form.elements.days.value)});
      openModal('Your access key is ready',`<p class="description">Created for <strong>${escape(result.label)}</strong>. Copy it now; you won’t be able to see it again.</p><div id="generated-key" class="mono">${escape(result.key)}</div><div class="notice key-banner">${icon('shield')}<p>Share this privately. Anyone holding this key can moderate and reset your server.</p></div><div class="modal-actions"><button class="button" data-command="modal-close">Done</button><button class="button primary" id="copy-key">${icon('copy')} Copy key</button></div>`);
      $('#copy-key').addEventListener('click',async()=>{ try { await navigator.clipboard.writeText($('#generated-key').textContent); toast('Key copied. Share it privately.'); } catch { toast('Select the key and copy it manually.',true); } });
      void renderKeys();
    });
  });
}
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer=setTimeout(async()=>{
    if(!session||!currentJob) return;
    try {
      currentJob=await api(`/jobs/${currentJob.id}`);
      if(page==='reset') renderReset();
      if(['queued','running'].includes(currentJob.status)) schedulePoll();
      else { toast(`Reset ${currentJob.status}: ${currentJob.succeeded} completed, ${currentJob.failed} failed.`); await refresh(); }
    } catch(e) { toast(e.message,true); if(session) schedulePoll(); }
  },1500);
}

$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();
  await submit(e.target,async()=>{ session=await post('/login',{key:$('#access-key').value.trim()}); $('#access-key').value=''; page='overview'; await enter(); },'#login-error');
});
$('#logout').addEventListener('click',async()=>{try{await post('/logout',{}); signOutUI();}catch(e){toast(e.message,true);}});
$('#refresh').addEventListener('click',()=>refresh().catch(e=>toast(e.message,true)));
$('#mobile-menu').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('open'); $('#mobile-menu').setAttribute('aria-expanded',String(open));});
$('#navigation').addEventListener('click',e=>{const button=e.target.closest('[data-page]'); if(button) navigate(button.dataset.page);});
$('#close-modal').addEventListener('click',()=>$('#modal').close());
$('#modal').addEventListener('close',()=>$('#modal-body').replaceChildren());
document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-command]'); if(!button) return;
  const command=button.dataset.command,id=button.dataset.id;
  try {
    if(command==='navigate') navigate(button.dataset.pageTarget);
    if(command==='refresh') await refresh();
    if(command==='moderate') moderationModal();
    if(command==='member') moderationModal(id);
    if(command==='unban') moderationModal('','unban');
    if(command==='purge') moderationModal('','purge',id);
    if(command==='modal-close') $('#modal').close();
    if(command==='key-new') newKey();
    if(command==='key-revoke') {
      openModal('Revoke this access key?',`<p class="description">This immediately ends access for anyone using the key, including existing sessions.</p><p id="modal-error" class="form-error" role="alert"></p><form id="revoke-form"><div class="modal-actions"><button type="button" class="button" data-command="modal-close">Cancel</button><button type="submit" class="button danger">Revoke key</button></div></form>`);
      $('#revoke-form').addEventListener('submit',async e=>{e.preventDefault(); await submit(e.target,async()=>{await api(`/keys/${id}`,{method:'DELETE'});$('#modal').close();toast('Access key revoked.');void renderKeys();});});
    }
    if(command==='warnings') {
      const warnings=await api(`/members/${id}/warnings`);
      openModal('Warning history',warnings.length?activity(warnings):'<div class="empty">No warnings recorded for this member.</div>');
    }
    if(command==='reset-back'){plan=null;renderReset();}
    if(command==='reset-new'){currentJob=null;await refresh();}
  }catch(error){toast(error.message,true);}
});
api('/session').then(result=>{session=result;return enter();}).catch(e=>{if(session)toast(e.message,true);});
