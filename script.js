// 1. CONFIGURATION
const SUPABASE_URL = 'https://wnmwvbeydsrehtsnkfoc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndubXd2YmV5ZHNyZWh0c25rZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzMDg4MzIsImV4cCI6MjA3OTg4NDgzMn0.4vSObxBEr8r11-dqkp9y6bVroMVoSTEnIOTF8Vo8sxk';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. VARIABLES
let currentUser = null;
let appSettings = {};
let adFuncs = { interstitial: null, rewarded: null, popup: null };
let adStartTime = 0;
let pendingTask = null;
let currentAuthMode = 'login'; // login or signup
const MIN_AD_DURATION = 10000; // 10 Seconds

// 3. INITIALIZATION & AUTH FLOW
async function initApp() {
    // Load Settings First (Critical for Device Check)
    try {
        const { data: sData } = await supabase.from('settings').select('*').single();
        appSettings = sData || { 
            conversion_rate: 0.05, min_withdraw_amount: 50, daily_task_limit: 10, 
            anti_cheat_enabled: true, bot_username: 'MyBot_bot', referral_bonus: 50,
            allow_multi_accounts: false // Default to false (Restricted)
        };

        // Check if user is already logged in via LocalStorage
        const savedUserId = localStorage.getItem('session_user_id');
        if (savedUserId) {
            await loadUserAndStart(parseInt(savedUserId));
        } else {
            document.getElementById('loading-txt').classList.add('hidden');
        }

    } catch (err) {
        console.error("Init Error:", err);
        Swal.fire("Connection Error", "Please refresh the page", "error");
    }
}

// 4. AUTHENTICATION LOGIC
function toggleAuth(mode) {
    currentAuthMode = mode;
    const btn = document.getElementById('auth-btn');
    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    const extraFields = document.getElementById('signup-fields');

    if (mode === 'login') {
        loginTab.className = "flex-1 py-2 rounded-md text-sm font-bold bg-[#FFD700] text-black transition-all";
        signupTab.className = "flex-1 py-2 rounded-md text-sm font-bold text-gray-400 transition-all";
        extraFields.classList.add('hidden');
        btn.innerText = "Login Now";
    } else {
        loginTab.className = "flex-1 py-2 rounded-md text-sm font-bold text-gray-400 transition-all";
        signupTab.className = "flex-1 py-2 rounded-md text-sm font-bold bg-[#FFD700] text-black transition-all";
        extraFields.classList.remove('hidden');
        btn.innerText = "Create Account";
    }
}

async function handleAuthSubmit() {
    const phone = document.getElementById('auth-phone').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();
    
    if (!phone || !pass) return Swal.fire("Error", "Enter Phone & Password", "warning");

    const btn = document.getElementById('auth-btn');
    btn.disabled = true; 
    btn.innerText = "Processing...";

    if (currentAuthMode === 'login') {
        // --- LOGIN LOGIC ---
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', phone) // Assuming Phone is ID
            .eq('password', pass) // Basic check (In production, use hashing)
            .single();

        if (user) {
            localStorage.setItem('session_user_id', user.id);
            await loadUserAndStart(user.id);
        } else {
            Swal.fire("Failed", "Invalid Phone or Password", "error");
            btn.disabled = false; btn.innerText = "Login Now";
        }
    } else {
        // --- SIGNUP LOGIC ---
        const name = document.getElementById('auth-name').value.trim();
        const refCode = document.getElementById('auth-ref').value.trim();

        if (!name) {
            btn.disabled = false; btn.innerText = "Create Account";
            return Swal.fire("Error", "Enter your Name", "warning");
        }

        // DEVICE CHECK (Admin Control)
        const isMultiAllowed = appSettings.allow_multi_accounts; // Boolean from DB
        const hasAccountOnDevice = localStorage.getItem('device_has_account');

        if (!isMultiAllowed && hasAccountOnDevice) {
            btn.disabled = false; btn.innerText = "Create Account";
            return Swal.fire("Restricted", "Only one account per device is allowed by Admin.", "error");
        }

        // Prepare Data
        let refId = refCode ? parseInt(refCode) : null;
        
        // Anti-Cheat for Referral (Optional)
        if (appSettings.anti_cheat_enabled && refId && localStorage.getItem('device_ref_used')) {
            refId = null; // Prevent self-referral abuse on same device
        }

        const { data: newUser, error: cError } = await supabase.from('users').insert([{
            id: parseInt(phone), 
            first_name: name, 
            username: name.toLowerCase().replace(/\s/g, ''),
            password: pass, // Storing plain text as requested (Not recommended for high security)
            photo_url: `https://ui-avatars.com/api/?name=${name}&background=random`,
            referred_by: refId, 
            balance: 0
        }]).select().single();

        if (cError) {
            let msg = "Registration Failed";
            if (cError.code === '23505') msg = "Phone number already exists!"; // Duplicate Key
            Swal.fire("Error", msg, "error");
            btn.disabled = false; btn.innerText = "Create Account";
        } else {
            // Success
            if (refId) {
                await supabase.rpc('increment_referral', { referrer_id: refId });
                localStorage.setItem('device_ref_used', 'true');
            }
            
            // Mark Device as used
            localStorage.setItem('device_has_account', 'true');
            localStorage.setItem('session_user_id', newUser.id);
            
            await loadUserAndStart(newUser.id);
        }
    }
}

function logout() {
    Swal.fire({
        title: 'Logout?',
        text: "You will be returned to login screen.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#FFD700',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Yes, Logout'
    }).then((result) => {
        if (result.isConfirmed) {
            localStorage.removeItem('session_user_id');
            location.reload();
        }
    });
}

// 5. MAIN APP LOAD
async function loadUserAndStart(userId) {
    // Fetch fresh user data
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    
    if (!user) {
        localStorage.removeItem('session_user_id');
        location.reload();
        return;
    }

    currentUser = user;
    
    // Switch Screens
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-interface').classList.remove('hidden');

    // Load Ads
    if (appSettings.monetag_interstitial_id) loadScript(appSettings.monetag_interstitial_id, (n) => adFuncs.interstitial = n);
    if (appSettings.monetag_rewarded_id) loadScript(appSettings.monetag_rewarded_id, (n) => adFuncs.rewarded = n);
    if (appSettings.monetag_popup_id) loadScript(appSettings.monetag_popup_id, (n) => adFuncs.popup = n);

    updateUI();
    router('home');
}

// 6. HELPERS (Standard)
function loadScript(zoneId, cb) {
    const s = document.createElement('script');
    s.src = '//libtl.com/sdk.js';
    const fname = 'show_' + zoneId;
    s.setAttribute('data-zone', zoneId);
    s.setAttribute('data-sdk', fname);
    s.onload = () => cb(fname);
    document.head.appendChild(s);
}

function updateUI() {
    if(!currentUser) return;
    document.getElementById('user-name').innerText = currentUser.first_name;
    document.getElementById('user-balance').innerText = Math.floor(currentUser.balance);
    if(currentUser.photo_url) document.getElementById('user-photo').src = currentUser.photo_url;
}

function router(page) {
    document.querySelectorAll('.nav-item').forEach(b => {
        b.classList.remove('active', 'text-[#FFD700]');
        b.classList.add('text-gray-500');
    });
    document.getElementById(`btn-${page}`).classList.add('active', 'text-[#FFD700]');
    const c = document.getElementById('main-app');
    
    if (page === 'home') renderHome(c);
    else if (page === 'tasks') renderTasks(c);
    else if (page === 'wallet') renderWallet(c);
    else if (page === 'history') renderHistory(c);
    else if (page === 'refer') renderRefer(c);
}

// 7. PAGE: HOME
function renderHome(c) {
    const bdt = (currentUser.balance * appSettings.conversion_rate).toFixed(2);
    
    if(adFuncs.interstitial && window[adFuncs.interstitial]) {
        window[adFuncs.interstitial]({ type: 'inApp', inAppSettings: { frequency: 2, capping: 0.1, interval: 30, timeout: 5, everyPage: false } });
    }

    c.innerHTML = `
        <div class="glass-panel p-6 rounded-3xl text-center relative overflow-hidden mt-2 shadow-2xl border-t border-white/10">
            <div class="absolute -top-10 -left-10 w-40 h-40 bg-[#FFD700] rounded-full blur-[80px] opacity-20"></div>
            <p class="text-gray-400 text-xs uppercase tracking-[3px] mb-2 font-bold">Total Earnings</p>
            <h1 class="text-6xl font-bold text-white mb-2">${currentUser.balance}</h1>
            <div class="inline-block bg-white/5 border border-white/10 rounded-full px-5 py-1.5 mt-1">
                <p class="text-xs text-[#FFD700] font-bold tracking-wide">≈ \u09F3 ${bdt} BDT</p>
            </div>
            <button onclick="router('tasks')" class="mt-8 w-full py-4 rounded-2xl gold-gradient text-black font-bold shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2 uppercase tracking-wider">
                <i class="fas fa-play"></i> Start Earning
            </button>
        </div>
        <div class="grid grid-cols-2 gap-4 mt-6">
            <div class="glass-panel p-5 rounded-2xl flex flex-col items-center justify-center border border-white/5">
                <i class="fas fa-users text-3xl mb-2 text-blue-400"></i>
                <span class="text-2xl font-bold">${currentUser.referral_count}</span>
                <span class="text-[10px] text-gray-400 uppercase mt-1">Refers</span>
            </div>
            <div class="glass-panel p-5 rounded-2xl flex flex-col items-center justify-center border border-white/5">
                <i class="fas fa-check-circle text-3xl mb-2 text-green-400"></i>
                <span class="text-2xl font-bold">Active</span>
                <span class="text-[10px] text-gray-400 uppercase mt-1">Status</span>
            </div>
        </div>
        ${appSettings.home_banner_url ? `<div class="mt-6 mb-4 rounded-2xl overflow-hidden shadow-lg border border-[#FFD700]/30 w-full h-40"><img src="${appSettings.home_banner_url}" class="w-full h-full object-cover"></div>` : ''}
    `;
}

// 8. PAGE: TASKS
async function renderTasks(c) {
    c.innerHTML = `<div class="flex justify-center mt-20"><div class="loader"></div></div>`;
    
    const { data: tasks } = await supabase.from('tasks').select('*').eq('is_active', true).order('id');
    const today = new Date().toISOString().split('T')[0];
    const { data: logs } = await supabase.from('task_logs').select('task_id').eq('user_id', currentUser.id).eq('created_at', today);

    const counts = {};
    if (logs) logs.forEach(l => counts[l.task_id] = (counts[l.task_id] || 0) + 1);
    
    const locked = appSettings.referral_lock && (currentUser.referral_count < appSettings.min_referrals_req);
    const limit = appSettings.daily_task_limit || 10;

    let html = `
        <div class="flex justify-between items-center mb-5 mt-2 px-1">
            <h2 class="text-lg font-bold text-white">Task List</h2>
            <span class="text-[10px] bg-white/10 px-3 py-1 rounded-lg text-gray-300 border border-white/10">Limit: ${limit}</span>
        </div>
    `;

    if (locked) {
        html += `
            <div class="bg-red-500/10 border border-red-500/50 p-4 rounded-xl mb-6 text-center text-xs text-red-400">
                <i class="fas fa-lock text-xl mb-2 block"></i>
                Invite <b>${appSettings.min_referrals_req - currentUser.referral_count}</b> more friends to unlock.
            </div>`;
    }

    html += `<div class="space-y-4 pb-10">`;
    
    tasks.forEach(t => {
        let icon = 'star', btn = 'Claim', bCol = 'bg-gray-500/20';
        if (t.task_type === 'direct_ad') { icon = 'globe'; btn = 'Visit'; bCol = 'bg-blue-500/20 text-blue-400'; }
        else if (t.task_type === 'telegram') { icon = 'paper-plane'; btn = 'Join'; bCol = 'bg-cyan-500/20 text-cyan-400'; }
        else if (t.task_type === 'video') { icon = 'play-circle'; btn = 'Watch'; bCol = 'bg-purple-500/20 text-purple-400'; }

        const cnt = counts[t.id] || 0;
        const disabled = locked || cnt >= limit;
        const btnClass = disabled ? 'bg-white/5 text-gray-500 cursor-not-allowed' : 'gold-gradient text-black hover:opacity-90 active:scale-95';

        html += `
            <div class="glass-panel p-4 rounded-2xl flex justify-between items-center ${disabled?'opacity-60 grayscale':''}">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-[#FFD700] border border-white/10 shadow-lg"><i class="fas fa-${icon} text-xl"></i></div>
                    <div>
                        <h4 class="font-bold text-sm text-white line-clamp-1 mb-1">${t.title}</h4>
                        <div class="flex items-center gap-2">
                            <span class="text-[9px] ${bCol} px-1.5 py-0.5 rounded font-bold tracking-wider">TASK</span>
                            <span class="text-[10px] text-[#FFD700] font-bold border border-[#FFD700]/20 px-1.5 py-0.5 rounded">+${t.reward}</span>
                            <span class="text-[10px] text-gray-500 font-mono pl-2 border-l border-white/10">${cnt}/${limit}</span>
                        </div>
                    </div>
                </div>
                <button onclick="handleTask(${t.id}, ${t.reward}, '${t.task_type}', '${t.link || ''}')" 
                    ${disabled?'disabled':''} 
                    class="px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${btnClass}">
                    ${cnt >= limit ? 'Done' : btn}
                </button>
            </div>`;
    });
    c.innerHTML = html + `</div>`;
}

// 9. AD & TASK LOGIC
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && adStartTime > 0 && pendingTask) {
        const duration = Date.now() - adStartTime;
        if (duration >= MIN_AD_DURATION) {
            claimReward(pendingTask.id, pendingTask.reward);
        } else {
            Swal.fire({ icon: 'warning', title: 'Too Fast!', text: `Wait 10s. Returned in ${(duration/1000).toFixed(1)}s`, confirmButtonColor: '#FFD700' });
        }
        adStartTime = 0; pendingTask = null;
    }
});

window.handleTask = async (tid, rew, type, link) => {
    pendingTask = { id: tid, reward: rew };
    adStartTime = Date.now();

    if (type === 'direct_ad') {
        const url = (link && link !== 'null') ? link : appSettings.monetag_direct_link;
        if(url) { 
            window.open(url, '_blank'); 
            setTimeout(() => { if(adFuncs.interstitial && window[adFuncs.interstitial]) window[adFuncs.interstitial](); }, 1000); 
        } else {
            Swal.fire('Error', 'No Link', 'error');
        }
    } 
    else if (type === 'telegram') {
        if(link) window.open(link, '_blank');
        if(adFuncs.popup && window[adFuncs.popup]) window[adFuncs.popup]('pop');
    } 
    else if (type === 'video') {
        if(adFuncs.rewarded && window[adFuncs.rewarded]) {
            window[adFuncs.rewarded]().then(() => { 
                claimReward(tid, rew); 
                adStartTime = 0; 
                pendingTask = null; 
            });
        }
    } 
    else {
        if(link && link !== 'null') window.open(link, '_blank');
        if(adFuncs.interstitial && window[adFuncs.interstitial]) window[adFuncs.interstitial]();
    }
};

async function claimReward(tid, rew) {
    Swal.showLoading();
    const { data: res } = await supabase.rpc('claim_task', { 
        p_user_id: currentUser.id, 
        p_task_id: tid, 
        p_reward: rew, 
        p_limit: appSettings.daily_task_limit 
    });
    Swal.close();
    
    if (res && res.success) {
        currentUser.balance += rew; updateUI();
        Swal.fire({ icon: 'success', title: `+${rew} Points`, toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
        router('tasks');
    } else {
        Swal.fire({ icon: 'error', title: 'Oops', text: res?.message });
    }
}

// 10. WALLET PAGE
function renderWallet(c) {
    const bdt = (currentUser.balance * appSettings.conversion_rate).toFixed(2);
    c.innerHTML = `
        <div class="glass-panel p-6 rounded-2xl text-center mb-6 mt-4 relative overflow-hidden shadow-2xl">
            <div class="absolute -right-10 -top-10 w-32 h-32 bg-green-500/20 rounded-full blur-[60px]"></div>
            <p class="text-gray-400 text-xs font-bold uppercase tracking-widest">Available Funds</p>
            <h1 class="text-5xl font-bold gold-text my-3">\u09F3 ${bdt}</h1>
            <div class="inline-block bg-white/5 px-4 py-1.5 rounded-full border border-white/10"><p class="text-[10px] text-gray-400">Min: \u09F3 ${appSettings.min_withdraw_amount}</p></div>
        </div>
        <div class="space-y-6">
            <div><label class="text-xs text-gray-400 ml-1 font-bold uppercase">Method</label><div class="mt-2 glass-panel p-4 rounded-xl border border-[#FFD700] flex items-center justify-between bg-[#FFD700]/5"><div class="flex items-center gap-3"><img src="https://freelogopng.com/images/all_img/1656234745bkash-app-logo-png.png" class="h-8 object-contain"><span class="font-bold text-sm text-white">Bkash Personal</span></div><i class="fas fa-check-circle text-[#FFD700] text-xl"></i></div></div>
            <div class="space-y-3">
                <div><label class="text-xs text-gray-400 ml-1 font-bold">Number</label><input type="number" id="w-num" placeholder="017xxxxxxxx" class="custom-input"></div>
                <div><label class="text-xs text-gray-400 ml-1 font-bold">Amount</label><input type="number" id="w-amt" placeholder="Min ${appSettings.min_withdraw_amount}" class="custom-input"></div>
            </div>
            <button id="w-btn" onclick="processWithdraw()" class="w-full py-4 rounded-xl gold-gradient text-black font-bold mt-4 shadow-lg active:scale-95 transition-transform text-sm uppercase tracking-wide flex items-center justify-center gap-2">Submit Request</button>
        </div>`;
}

async function processWithdraw() {
    const btn = document.getElementById('w-btn');
    const num = document.getElementById('w-num').value;
    const amt = parseInt(document.getElementById('w-amt').value);
    
    if (!num || !amt) return Swal.fire('Error', 'Fill all fields', 'warning');
    if (amt < appSettings.min_withdraw_amount) return Swal.fire('Error', `Min \u09F3${appSettings.min_withdraw_amount}`, 'warning');
    
    const pts = amt / appSettings.conversion_rate;
    if (currentUser.balance < pts) return Swal.fire('Error', 'Insufficient Balance', 'error');

    btn.disabled = true; btn.innerText = "Processing...";
    if(adFuncs.interstitial && window[adFuncs.interstitial]) await window[adFuncs.interstitial]().catch(()=>{});

    const { data: res } = await supabase.rpc('process_withdrawal', { 
        p_user_id: currentUser.id, p_method: 'Bkash', p_number: num, p_amount_bdt: amt, p_points_needed: pts 
    });

    if (res && res.success) {
        currentUser.balance -= pts; updateUI();
        Swal.fire('Success', 'Request Sent!', 'success'); router('history');
    } else {
        Swal.fire('Error', res?.message || 'Failed', 'error');
        btn.disabled = false; btn.innerText = "Submit Request";
    }
}

// 11. HISTORY PAGE
async function renderHistory(c) {
    c.innerHTML = `<div class="w-full h-full flex justify-center items-center mt-20"><div class="loader"></div></div>`;
    const { data: w } = await supabase.from('withdrawals').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    let html = `<div class="my-4 px-1"><h2 class="text-lg font-bold mb-4 ml-1 text-white flex items-center gap-2"><i class="fas fa-history text-[#FFD700]"></i> Transaction History</h2>`;
    
    if (!w || w.length === 0) {
        html += `<div class="text-center text-gray-500 text-sm mt-20">No transactions found.</div>`;
    } else {
        html += `<div class="space-y-3 pb-20">`;
        w.forEach(i => {
            let col = i.status==='paid'?'text-green-400':(i.status==='rejected'?'text-red-400':'text-yellow-400');
            html += `
                <div class="glass-panel p-4 rounded-xl flex justify-between items-center border-l-4 ${i.status==='paid'?'border-green-500/50':'border-yellow-500/50'}">
                    <div class="flex items-center gap-4">
                        <div><h4 class="font-bold text-sm text-white">\u09F3 ${i.amount_bdt}</h4><p class="text-[10px] text-gray-400 font-mono">${new Date(i.created_at).toLocaleDateString()}</p></div>
                    </div>
                    <span class="text-[10px] font-bold ${col} uppercase bg-white/5 px-2 py-1 rounded border border-white/5">${i.status}</span>
                </div>`;
        });
        html += `</div>`;
    }
    c.innerHTML = html;
}

// 12. REFER PAGE
function renderRefer(c) {
    const link = window.location.origin + '?ref=' + currentUser.id; // Updated for Web
    const bonus = appSettings.referral_bonus || 50;

    c.innerHTML = `
        <div class="glass-panel p-6 rounded-2xl text-center mt-4 border border-[#FFD700]/30 shadow-2xl">
            <h2 class="text-2xl font-bold text-white">Invite & Earn</h2>
            <p class="text-xs text-gray-400 mt-2 px-4">Get <b class="text-[#FFD700]">${bonus} points</b> per referral!</p>
        </div>
        <div class="glass-panel p-3 rounded-xl mt-6 flex items-center gap-3 bg-black/30 border border-white/10">
            <input type="text" value="${link}" readonly class="bg-transparent text-xs w-full text-gray-300 outline-none font-mono" id="ref-link">
            <button onclick="copyLink()" class="p-2.5 bg-[#FFD700] rounded-lg text-black font-bold text-xs"><i class="fas fa-copy"></i></button>
        </div>
        <div class="mt-6 glass-panel p-5 rounded-xl flex justify-between items-center shadow-lg border border-white/5"><div><p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Total Referrals</p><h4 class="text-3xl font-bold text-white">${currentUser.referral_count}</h4></div><div class="text-right"><p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Bonus Earned</p><h4 class="text-3xl font-bold text-[#FFD700]">${currentUser.referral_count * bonus}</h4></div></div>`;
}

window.copyLink = () => {
    const copyText = document.getElementById("ref-link");
    copyText.select();
    document.execCommand("copy");
    Swal.fire({ icon: 'success', title: 'Copied!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
};

// START
initApp();
