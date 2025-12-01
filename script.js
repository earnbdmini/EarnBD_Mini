// 1. CONFIGURATION
const SUPABASE_URL = 'https://wnmwvbeydsrehtsnkfoc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndubXd2YmV5ZHNyZWh0c25rZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzMDg4MzIsImV4cCI6MjA3OTg4NDgzMn0.4vSObxBEr8r11-dqkp9y6bVroMVoSTEnIOTF8Vo8sxk';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let appSettings = {};
let adFuncs = { interstitial: null, rewarded: null, popup: null };
let authMode = 'login';
const REQUIRED_TIME = 15000;

// --- POWERFUL DEVICE FINGERPRINT ---
function getDeviceFingerprint() {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const txt = 'PREMIUM_V3_SECURE';
        ctx.textBaseline = "top";
        ctx.font = "14px 'Arial'";
        ctx.fillStyle = "#f60";
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = "#069";
        ctx.fillText(txt, 2, 15);
        ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
        ctx.fillText(txt, 4, 17);
        
        // Browser info + Hardware info + Canvas hash
        const raw = canvas.toDataURL() + navigator.userAgent + navigator.hardwareConcurrency + screen.colorDepth + screen.width + screen.height;
        
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            const char = raw.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'DEV-' + Math.abs(hash);
    } catch(e) {
        return 'DEV-FALLBACK-' + navigator.userAgent.replace(/\D+/g, '');
    }
}

// 2. INITIALIZATION
async function initApp() {
    try {
        const { data: s } = await supabase.from('settings').select('*').single();
        appSettings = s || { device_lock_active: true, conversion_rate: 1000 };

        if(appSettings.monetag_interstitial_id) loadAdScript(appSettings.monetag_interstitial_id, 'interstitial');
        if(appSettings.monetag_rewarded_id) loadAdScript(appSettings.monetag_rewarded_id, 'rewarded');
        if(appSettings.monetag_popup_id) loadAdScript(appSettings.monetag_popup_id, 'popup');

        const uid = localStorage.getItem('user_id');
        const storedFP = localStorage.getItem('device_fp');
        const currentFP = getDeviceFingerprint();

        if (uid) {
            // সিকিউরিটি চেক: ডাটা ক্লিয়ার করে অন্য ডিভাইস থেকে ঢোকা যাবে না
            if(appSettings.device_lock_active && storedFP && storedFP !== currentFP) {
                Swal.fire({
                    icon: 'error',
                    title: 'Security Alert',
                    text: 'Device Mismatch! Please login from your original device.',
                    allowOutsideClick: false,
                    confirmButtonColor: '#d33'
                }).then(() => logout());
                return;
            }
            await fetchUser(uid);
        } else {
            showAuth();
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get('ref')) { 
            toggleAuth('signup'); 
            const refInput = document.getElementById('auth-ref');
            if(refInput) { refInput.value = params.get('ref'); refInput.readOnly = true; }
        }

    } catch (e) {
        console.error(e);
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('error-box').classList.remove('hidden');
    }
}

// 3. AUTHENTICATION (FIXED: NO parseInt)
function showAuth() {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-interface').classList.add('hidden');
}

function toggleAuth(mode) {
    authMode = mode;
    const login = document.getElementById('tab-login');
    const signup = document.getElementById('tab-signup');
    const extra = document.getElementById('signup-fields');
    const btn = document.getElementById('auth-btn');
    
    if(mode === 'login') {
        login.className = "flex-1 py-2 rounded-md text-sm font-bold bg-[#FFD700] text-black transition";
        signup.className = "flex-1 py-2 rounded-md text-sm font-bold text-gray-400 transition";
        extra.classList.add('hidden');
        btn.innerText = "LOGIN NOW";
    } else {
        signup.className = "flex-1 py-2 rounded-md text-sm font-bold bg-[#FFD700] text-black transition";
        login.className = "flex-1 py-2 rounded-md text-sm font-bold text-gray-400 transition";
        extra.classList.remove('hidden');
        btn.innerText = "CREATE ACCOUNT";
    }
}

async function submitAuth() {
    // এখানে parseInt ব্যবহার করা যাবে না। সরাসরি স্ট্রিং নেওয়া হচ্ছে।
    const phone = document.getElementById('auth-phone').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();
    
    if(!phone || !pass) return Swal.fire('Error', 'Please fill all fields', 'warning');
    if(phone.length < 11) return Swal.fire('Error', 'Invalid Phone Number', 'warning');

    const deviceId = getDeviceFingerprint(); 

    Swal.fire({ title: 'Processing...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        if (authMode === 'login') {
            // LOGIN: String comparison
            const { data, error } = await supabase.from('users').select('*').eq('id', phone).eq('password', pass).single();
            
            if (data) {
                // Device Check
                if(appSettings.device_lock_active && data.device_id && data.device_id !== deviceId) {
                    Swal.close();
                    return Swal.fire('Login Denied', 'This account is locked to another device.', 'error');
                }

                localStorage.setItem('user_id', data.id);
                localStorage.setItem('device_fp', deviceId);
                Swal.close();
                location.reload(); 
            } else {
                Swal.close();
                // ডিবাগিং এর জন্য কনসোল লগ
                console.log("Login Failed for:", phone, pass);
                Swal.fire('Login Failed', 'Invalid Phone or Password!', 'error');
            }
        } else {
            // REGISTER
            const name = document.getElementById('auth-name').value.trim();
            const refInput = document.getElementById('auth-ref').value.trim();
            
            if (!name) { Swal.close(); return Swal.fire('Error', 'Enter Name', 'warning'); }
            
            const refID = (refInput.length >= 11) ? refInput : null; 

            // RPC Call
            const { data: res, error } = await supabase.rpc('handle_new_user', {
                p_phone: phone, 
                p_pass: pass, 
                p_name: name, 
                p_referrer: refID,
                p_device_id: deviceId 
            });

            Swal.close();

            if (error) {
                console.error(error);
                return Swal.fire('System Error', error.message, 'error');
            }

            if (res && res.success) {
                localStorage.setItem('user_id', phone);
                localStorage.setItem('device_fp', deviceId);
                
                Swal.fire({
                    icon: 'success',
                    title: 'Welcome!',
                    text: 'Account created successfully.',
                    confirmButtonColor: '#FFD700'
                }).then(() => location.reload());
            } else {
                // Device limit or Phone exists error
                Swal.fire('Failed', res?.message || 'Unknown error', 'error');
            }
        }
    } catch (e) {
        Swal.close();
        console.error(e);
        Swal.fire('Error', 'Network Error', 'error');
    }
}

function logout() {
    localStorage.clear();
    location.reload();
}

async function fetchUser(uid) {
    const { data } = await supabase.from('users').select('*').eq('id', uid).single();
    if (data) {
        if (data.is_banned) {
            localStorage.clear();
            Swal.fire('Banned', 'Account Suspended.', 'error').then(() => location.reload());
            return;
        }
        currentUser = data;
        updateUI();
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-interface').classList.remove('hidden');
        document.getElementById('app-header').classList.remove('hidden');
        document.getElementById('app-nav').classList.remove('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        router('home');
    } else {
        localStorage.clear();
        location.reload();
    }
}

// 4. TASKS & UI LOGIC
document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
        const start = localStorage.getItem('t_start');
        const tid = localStorage.getItem('t_id');
        const rew = localStorage.getItem('t_rew');

        if (start && tid) {
            const diff = Date.now() - parseInt(start);
            if (diff >= REQUIRED_TIME) {
                await addPoints(tid, rew);
            } else {
                Swal.fire({icon: 'error', title: 'Task Failed', text: `You must stay for 15s.`, confirmButtonColor: '#FFD700'});
            }
            localStorage.removeItem('t_start'); localStorage.removeItem('t_id'); localStorage.removeItem('t_rew');
        }
    }
});

window.handleTask = (tid, rew, type, link) => {
    if(type === 'direct_ad' || type === 'website' || type === 'offer_wheel') {
        const url = (link && link !== 'null') ? link : appSettings.monetag_direct_link;
        if(!url) return Swal.fire('Error', 'Link Not Found', 'error');
        localStorage.setItem('t_start', Date.now()); localStorage.setItem('t_id', tid); localStorage.setItem('t_rew', rew);
        window.open(url, '_blank');
        Swal.fire({title: 'Task Started', text: 'Wait 15 seconds...', timer: 3000, showConfirmButton: false});
    } else if(type === 'video' || type === 'rewarded_ads') {
        if(adFuncs.rewarded && window[adFuncs.rewarded]) {
            Swal.fire({title: 'Loading Ad...', didOpen: () => Swal.showLoading(), showConfirmButton: false});
            window[adFuncs.rewarded]().then(() => { Swal.close(); addPoints(tid, rew); }).catch(e => { Swal.close(); Swal.fire('Failed', 'Ad Closed!', 'error'); });
        } else { Swal.fire('Ad Not Ready', 'Try again later', 'warning'); }
    } else {
        if(link && link !== 'null') window.open(link, '_blank');
        setTimeout(() => addPoints(tid, rew), 5000);
    }
};

async function addPoints(tid, rew) {
    Swal.fire({title: 'Checking...', didOpen: () => Swal.showLoading(), showConfirmButton: false});
    try {
        const { data: res, error } = await supabase.rpc('claim_task', {
            p_user_id: currentUser.id, p_task_id: parseInt(tid), p_reward: parseFloat(rew), p_limit: parseInt(appSettings.daily_task_limit || 15)
        });
        Swal.close();
        if (res && res.success) {
            currentUser.balance += parseFloat(rew); updateUI();
            Swal.fire({icon: 'success', title: 'Points Added!', timer: 1500, showConfirmButton: false});
            if(document.getElementById('btn-tasks').classList.contains('active')) router('tasks');
        } else { Swal.fire('Limit Reached', res?.message, 'warning'); }
    } catch(e) { Swal.close(); }
}

async function processWithdraw() {
    const num = document.getElementById('w-num').value.trim();
    const amt = parseFloat(document.getElementById('w-amt').value);
    const method = document.getElementById('w-method').value;
    const pts = parseFloat((amt * appSettings.conversion_rate).toFixed(2));

    if(!num || !amt) return Swal.fire('Error', 'Fill all fields', 'warning');
    if(amt < appSettings.min_withdraw_amount) return Swal.fire('Error', `Min withdraw: ${appSettings.min_withdraw_amount} TK`, 'warning');
    if(currentUser.balance < pts) return Swal.fire('Error', 'Insufficient Balance', 'error');

    const btn = document.getElementById('w-btn'); btn.innerText = "Processing..."; btn.disabled = true;
    try {
        const { data: res } = await supabase.rpc('process_withdrawal', {
            p_user_id: currentUser.id, p_method: method, p_number: num, p_amount_bdt: amt, p_points_needed: pts
        });
        btn.innerText = "WITHDRAW REQUEST"; btn.disabled = false;
        if (res && res.success) {
            currentUser.balance -= pts; updateUI();
            Swal.fire({icon: 'success', title: 'Submitted', text: 'Withdrawal pending...'}); router('history');
        } else { Swal.fire('Failed', res?.message, 'error'); }
    } catch (err) { btn.disabled = false; Swal.fire('Error', 'Network Error', 'error'); }
}

function loadAdScript(zoneId, type) {
    try {
        const s = document.createElement('script'); s.src = '//libtl.com/sdk.js';
        s.dataset.zone = zoneId; s.dataset.sdk = 'show_' + zoneId;
        s.onload = () => adFuncs[type] = window['show_' + zoneId];
        document.head.appendChild(s);
    } catch(e) {}
}

function updateUI() {
    if(!currentUser) return;
    document.getElementById('user-name').innerText = currentUser.first_name || 'User';
    document.getElementById('user-balance').innerText = Math.floor(currentUser.balance);
    document.getElementById('user-photo').src = currentUser.photo_url || `https://ui-avatars.com/api/?name=${currentUser.first_name}&background=random`;
}

function router(page) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active', 'text-[#FFD700]'));
    document.getElementById('btn-'+page)?.classList.add('active', 'text-[#FFD700]');
    const c = document.getElementById('main-app');
    if(page === 'home') renderHome(c);
    else if(page === 'tasks') renderTasks(c);
    else if(page === 'wallet') renderWallet(c);
    else if(page === 'history') renderHistory(c);
    else if(page === 'refer') renderRefer(c);
}

function renderHome(c) {
    c.innerHTML = `<div class="glass-panel p-6 rounded-3xl text-center mt-4 border-t border-white/10 shadow-lg">
        <h1 class="text-5xl font-bold text-white mb-2">${Math.floor(currentUser.balance)}</h1>
        <p class="text-xs text-[#FFD700] tracking-widest uppercase">Points</p>
        <button onclick="router('tasks')" class="mt-6 w-full py-4 rounded-2xl gold-gradient text-black font-bold uppercase shadow-lg transition">START WORK</button>
    </div>
    <div class="mt-4 text-center text-gray-500 text-[10px]">ID: ${currentUser.id}</div>`;
}

async function renderTasks(c) {
    c.innerHTML = `<div class="flex justify-center mt-20"><div class="loader"></div></div>`;
    const { data: tasks } = await supabase.from('tasks').select('*').eq('is_active', true).order('id');
    const { data: logs } = await supabase.from('task_logs').select('task_id').eq('user_id', currentUser.id).eq('created_at', new Date().toISOString().split('T')[0]);
    const counts = {}; if(logs) logs.forEach(l => counts[l.task_id] = (counts[l.task_id] || 0) + 1);
    const limit = appSettings.daily_task_limit || 15;
    
    let html = `<div class="space-y-4 mt-4 pb-20">`;
    if (tasks && tasks.length) tasks.forEach(t => {
        const done = counts[t.id] || 0; const disabled = done >= limit;
        html += `<div class="glass-panel p-4 rounded-2xl flex justify-between items-center ${disabled?'opacity-50':''}">
            <div class="flex items-center gap-3"><div class="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-[#FFD700]"><i class="fas fa-globe"></i></div>
            <div><h4 class="font-bold text-white text-sm">${t.title}</h4><span class="text-xs text-[#FFD700]">+${t.reward} (${done}/${limit})</span></div></div>
            <button onclick="handleTask(${t.id}, ${t.reward}, '${t.task_type}', '${t.link}')" ${disabled?'disabled':''} class="px-5 py-2.5 rounded-xl text-xs font-bold gold-gradient text-black">${disabled?'Done':'Visit'}</button></div>`;
    });
    c.innerHTML = html + `</div>`;
}

function renderWallet(c) {
    const bdt = (currentUser.balance / appSettings.conversion_rate).toFixed(2);
    let opts = appSettings.payment_methods ? appSettings.payment_methods.map(m=>`<option value="${m}">${m}</option>`).join('') : '';
    c.innerHTML = `<div class="glass-panel p-6 rounded-2xl text-center mt-4"><h1 class="text-4xl font-bold text-white">\u09F3 ${bdt}</h1><p class="text-xs text-gray-400">Min: ${appSettings.min_withdraw_amount} TK</p></div>
    <div class="space-y-4 mt-6">
    <select id="w-method" class="custom-input">${opts}</select>
    <input type="number" id="w-num" placeholder="Account Number" class="custom-input">
    <input type="number" id="w-amt" placeholder="Amount (BDT)" class="custom-input">
    <button id="w-btn" onclick="processWithdraw()" class="w-full py-4 rounded-xl gold-gradient text-black font-bold mt-4 shadow-lg">WITHDRAW REQUEST</button></div>`;
}

async function renderRefer(c) {
    const link = `${location.origin}${location.pathname}?ref=${currentUser.id}`;
    const { data: refers } = await supabase.from('users').select('first_name, created_at, id').eq('referred_by', currentUser.id);
    let hist = refers?.map(u=>`<div class="flex justify-between bg-white/5 p-3 rounded-lg mb-2"><p class="text-sm font-bold text-white">${u.first_name}</p><p class="text-[10px] text-gray-400">${u.id.slice(0,3)}***${u.id.slice(-2)}</p></div>`).join('') || '<div class="text-center text-gray-500 py-4">No refers</div>';
    c.innerHTML = `<div class="glass-panel p-6 rounded-2xl text-center mt-4 border border-[#FFD700]/30"><h2 class="text-2xl font-bold text-white">Refer & Earn</h2><p class="text-xs text-gray-400">Bonus: ${appSettings.referral_bonus} pts</p></div>
    <div class="glass-panel p-3 rounded-xl mt-6 flex gap-3 bg-black/30"><input type="text" value="${link}" readonly class="bg-transparent text-xs w-full text-white" id="ref-link"><button onclick="copyLink()" class="p-2 bg-[#FFD700] rounded text-black"><i class="fas fa-copy"></i></button></div>
    <div class="mt-6"><h3 class="text-sm font-bold text-gray-400 mb-3">Refer History</h3><div class="overflow-y-auto max-h-60 space-y-1">${hist}</div></div>`;
}

function renderHistory(c) {
    c.innerHTML = `<div class="text-center mt-10"><div class="loader"></div></div>`;
    supabase.from('withdrawals').select('*').eq('user_id', currentUser.id).order('created_at', {ascending:false}).then(({data}) => {
        let html = data?.map(i=>`<div class="glass-panel p-4 rounded-xl flex justify-between border-l-4 ${i.status=='paid'?'border-green-500':'border-yellow-500'}"><div><h4 class="font-bold text-white">\u09F3 ${i.amount_bdt}</h4><p class="text-[10px] text-gray-400">${i.method}</p></div><span class="text-[10px] font-bold px-2 py-1 rounded bg-white/10 uppercase">${i.status}</span></div>`).join('') || '<div class="text-center text-gray-500">No History</div>';
        c.innerHTML = `<div class="space-y-3 mt-4">${html}</div>`;
    });
}

function copyLink() {
    document.getElementById("ref-link").select(); document.execCommand("copy");
    Swal.fire({icon: 'success', title: 'Copied!', toast: true, position: 'top', showConfirmButton: false, timer: 1000});
}

initApp();
