// 1. CONFIGURATION
// আপনার সুপাবেস প্রোজেক্টের URL এবং KEY
const SUPABASE_URL = 'https://wnmwvbeydsrehtsnkfoc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndubXd2YmV5ZHNyZWh0c25rZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzMDg4MzIsImV4cCI6MjA3OTg4NDgzMn0.4vSObxBEr8r11-dqkp9y6bVroMVoSTEnIOTF8Vo8sxk';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global Variables
let currentUser = null;
let appSettings = {};
let adFuncs = { interstitial: null, rewarded: null, popup: null };
let authMode = 'login';
const REQUIRED_TIME = 15000; // ১৫ সেকেন্ড টাইমার

// Device ID Generator (Anti-Cheat এর জন্য)
function getDeviceFingerprint() {
    return 'DEV-' + navigator.userAgent.replace(/\D+/g, '').substring(0, 12);
}

// 2. INITIALIZATION (অ্যাপ চালু হওয়া)
async function initApp() {
    try {
        // ১. সেটিংস লোড
        const { data: s, error } = await supabase.from('settings').select('*').single();
        if (error || !s) {
            console.warn("Settings not found, using defaults");
            appSettings = { 
                conversion_rate: 1, 
                min_withdraw_amount: 20, 
                monetag_direct_link: 'https://google.com',
                payment_methods: ["Bkash Personal"]
            };
        } else {
            appSettings = s;
        }

        // ২. অ্যাড স্ক্রিপ্ট লোড
        if(appSettings.monetag_interstitial_id) loadAdScript(appSettings.monetag_interstitial_id, 'interstitial');
        if(appSettings.monetag_rewarded_id) loadAdScript(appSettings.monetag_rewarded_id, 'rewarded');
        if(appSettings.monetag_popup_id) loadAdScript(appSettings.monetag_popup_id, 'popup');

        // ৩. লগইন চেক
        const uid = localStorage.getItem('user_id');
        if (uid) {
            await fetchUser(uid);
        } else {
            showAuth();
        }

        // ৪. রেফারেল চেক
        const params = new URLSearchParams(window.location.search);
        if (params.get('ref')) { 
            toggleAuth('signup'); 
            const refInput = document.getElementById('auth-ref');
            if(refInput) refInput.value = params.get('ref');
        }

    } catch (e) {
        console.error(e);
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('error-box').classList.remove('hidden');
    }
}

// 3. AUTHENTICATION (লগইন ও রেজিস্ট্রেশন)
function showAuth() {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
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
        btn.innerText = "LOGIN";
    } else {
        signup.className = "flex-1 py-2 rounded-md text-sm font-bold bg-[#FFD700] text-black transition";
        login.className = "flex-1 py-2 rounded-md text-sm font-bold text-gray-400 transition";
        extra.classList.remove('hidden');
        btn.innerText = "REGISTER";
    }
}

// এই ফাংশনটি HTML এর বাটনের সাথে কানেক্টেড
async function submitAuth() {
    const phoneInput = document.getElementById('auth-phone').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();
    
    if(!phoneInput || !pass) return Swal.fire('Error', 'Please fill all fields', 'warning');
    if(phoneInput.length !== 11) return Swal.fire('Error', 'Phone must be 11 digits', 'warning');

    const phone = parseInt(phoneInput);
    Swal.showLoading();

    try {
        if (authMode === 'login') {
            // LOGIN LOGIC
            const { data, error } = await supabase.from('users').select('*').eq('id', phone).eq('password', pass).single();
            Swal.close();
            
            if (data) {
                localStorage.setItem('user_id', data.id);
                // পেজ রিলোড দিয়ে ফ্রেশ স্টার্ট
                location.reload(); 
            } else {
                Swal.fire('Error', 'Invalid Phone or Password', 'error');
            }
        } else {
            // REGISTER LOGIC
            const name = document.getElementById('auth-name').value.trim();
            const refInput = document.getElementById('auth-ref').value.trim();
            const deviceId = getDeviceFingerprint(); 
            
            if (!name) { Swal.close(); return Swal.fire('Error', 'Enter your Name', 'warning'); }

            const refID = (refInput && !isNaN(refInput)) ? parseInt(refInput) : null;

            const { data: res, error } = await supabase.rpc('handle_new_user', {
                p_phone: phone, 
                p_pass: pass, 
                p_name: name, 
                p_referrer: refID,
                p_device_id: deviceId 
            });

            Swal.close();

            if (error) {
                return Swal.fire('System Error', error.message, 'error');
            }

            if (res && res.success) {
                localStorage.setItem('user_id', phone);
                location.reload();
            } else {
                Swal.fire('Failed', res?.message || 'Registration Error', 'error');
            }
        }
    } catch (e) {
        Swal.close();
        console.error(e);
        Swal.fire('Error', 'Network Error', 'error');
    }
}

// ইউজারের তথ্য আনা
async function fetchUser(uid) {
    const { data } = await supabase.from('users').select('*').eq('id', uid).single();
    if (data) {
        currentUser = data;
        updateUI();
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('app-header').classList.remove('hidden');
        document.getElementById('app-nav').classList.remove('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        router('home');
    } else {
        localStorage.removeItem('user_id');
        location.reload();
    }
}

// 4. TASK LOGIC (টাইমার এবং পয়েন্ট অ্যাড ফিক্স)
document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
        const start = localStorage.getItem('t_start');
        const tid = localStorage.getItem('t_id');
        const rew = localStorage.getItem('t_rew');

        if (start && tid) {
            const diff = Date.now() - parseInt(start);
            
            // ১৫ সেকেন্ড চেক
            if (diff >= REQUIRED_TIME) {
                await addPoints(tid, rew);
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Task Failed',
                    text: `You must stay for 15 seconds. You stayed only ${(diff/1000).toFixed(1)}s`,
                    confirmButtonColor: '#FFD700'
                });
            }
            // ক্লিনআপ
            localStorage.removeItem('t_start');
            localStorage.removeItem('t_id');
            localStorage.removeItem('t_rew');
        }
    }
});

window.handleTask = (tid, rew, type, link) => {
    // A. Direct Link / Offer Wheel
    if(type === 'direct_ad' || type === 'offer_wheel') {
        const url = (link && link !== 'null') ? link : appSettings.monetag_direct_link;
        if(!url) return Swal.fire('Error', 'Link Not Configured', 'error');

        // স্টার্ট টাইম সেভ
        localStorage.setItem('t_start', Date.now());
        localStorage.setItem('t_id', tid);
        localStorage.setItem('t_rew', rew);

        window.open(url, '_blank');
        
        Swal.fire({
            title: 'Task Started',
            text: 'Stay on the page for 15 seconds to get reward.',
            timer: 3000,
            showConfirmButton: false
        });
    }
    // B. Rewarded Video Ad
    else if(type === 'video' || type === 'rewarded_ads') {
        if(adFuncs.rewarded && window[adFuncs.rewarded]) {
            Swal.fire({title: 'Loading Ad...', didOpen: () => Swal.showLoading(), showConfirmButton: false});
            
            window[adFuncs.rewarded]().then(() => {
                Swal.close();
                // অ্যাড সম্পূর্ণ দেখলে পয়েন্ট অ্যাড হবে
                addPoints(tid, rew);
            }).catch(e => {
                Swal.close();
                Swal.fire('Failed', 'You closed the ad early!', 'error');
            });
        } else {
            Swal.fire('Loading', 'Ad is not ready yet. Please wait...', 'warning');
        }
    }
    // C. Other (Telegram etc.)
    else {
        if(link && link !== 'null') window.open(link, '_blank');
        setTimeout(() => addPoints(tid, rew), 5000);
    }
};

async function addPoints(tid, rew) {
    Swal.fire({title: 'Adding Points...', didOpen: () => Swal.showLoading(), showConfirmButton: false});
    
    try {
        const taskId = parseInt(tid);
        const rewardAmount = parseFloat(rew);
        const limit = parseInt(appSettings.daily_task_limit || 15);

        const { data: res, error } = await supabase.rpc('claim_task', {
            p_user_id: parseInt(currentUser.id),
            p_task_id: taskId,
            p_reward: rewardAmount,
            p_limit: limit
        });

        Swal.close();

        if (error) {
            console.error(error);
            return Swal.fire('Notice', 'System Error. Try again.', 'warning');
        }

        if (res && res.success) {
            currentUser.balance += rewardAmount;
            updateUI();
            
            Swal.fire({
                icon: 'success', 
                title: 'Points Added!', 
                text: `You earned +${rewardAmount} Points`,
                confirmButtonColor: '#FFD700',
                timer: 1500,
                showConfirmButton: false
            });
            
            router('tasks'); // রিফ্রেশ টাস্ক লিস্ট
        } else {
            Swal.fire('Limit Reached', res?.message, 'warning');
        }
    } catch(e) {
        Swal.close();
        console.error(e);
    }
}

// 5. WITHDRAW LOGIC (বাটন ফিক্স)
async function processWithdraw() {
    const num = document.getElementById('w-num').value;
    const amtVal = document.getElementById('w-amt').value;
    const method = document.getElementById('w-method').value;

    if(!num || !amtVal) return Swal.fire('Error', 'Please fill all fields', 'warning');

    const amt = parseFloat(amtVal);
    const pts = parseFloat((amt / appSettings.conversion_rate).toFixed(2));

    if(amt < appSettings.min_withdraw_amount) return Swal.fire('Error', `Minimum withdraw amount is ${appSettings.min_withdraw_amount} Taka`, 'warning');
    if(currentUser.balance < pts) return Swal.fire('Error', `Insufficient Balance! You need ${pts} Points`, 'error');

    document.getElementById('w-btn').innerText = "Processing...";
    document.getElementById('w-btn').disabled = true;
    
    try {
        const { data: res, error } = await supabase.rpc('process_withdrawal', {
            p_user_id: parseInt(currentUser.id),
            p_method: method,
            p_number: num,
            p_amount_bdt: amt,
            p_points_needed: pts
        });

        document.getElementById('w-btn').innerText = "WITHDRAW";
        document.getElementById('w-btn').disabled = false;

        if (res && res.success) {
            currentUser.balance -= pts;
            updateUI();
            Swal.fire({
                icon: 'success',
                title: 'Success',
                text: 'Withdrawal Request Submitted!',
                confirmButtonColor: '#FFD700'
            });
            router('history');
        } else {
            Swal.fire('Failed', res?.message || error?.message, 'error');
        }
    } catch (err) {
        document.getElementById('w-btn').disabled = false;
        Swal.fire('Error', 'Network Error', 'error');
    }
}

// 6. HELPER FUNCTIONS
function loadAdScript(zoneId, type) {
    const s = document.createElement('script');
    s.src = '//libtl.com/sdk.js';
    s.dataset.zone = zoneId;
    s.dataset.sdk = 'show_' + zoneId;
    s.onload = () => adFuncs[type] = window['show_' + zoneId];
    document.head.appendChild(s);
}

function updateUI() {
    if(!currentUser) return;
    document.getElementById('user-name').innerText = currentUser.first_name;
    document.getElementById('user-balance').innerText = Math.floor(currentUser.balance);
    // যদি ফটো না থাকে ডিফল্ট
    const photo = currentUser.photo_url || `https://ui-avatars.com/api/?name=${currentUser.first_name}&background=random`;
    document.getElementById('user-photo').src = photo;
}

function router(page) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active', 'text-[#FFD700]'));
    const btn = document.getElementById('btn-'+page);
    if(btn) btn.classList.add('active', 'text-[#FFD700]');
    
    const c = document.getElementById('main-app');
    if(page === 'home') renderHome(c);
    else if(page === 'tasks') renderTasks(c);
    else if(page === 'wallet') renderWallet(c);
    else if(page === 'history') renderHistory(c);
    else if(page === 'refer') renderRefer(c);
}

// 7. PAGES UI RENDERING
function renderHome(c) {
    c.innerHTML = `
    <div class="glass-panel p-6 rounded-3xl text-center mt-4 border-t border-white/10 shadow-lg">
        <h1 class="text-5xl font-bold text-white mb-2">${Math.floor(currentUser.balance)}</h1>
        <p class="text-xs text-[#FFD700] tracking-widest uppercase">Available Points</p>
        <button onclick="router('tasks')" class="mt-6 w-full py-4 rounded-2xl gold-gradient text-black font-bold uppercase shadow-lg active:scale-95 transition">START WORK</button>
    </div>
    
    <div class="grid grid-cols-2 gap-4 mt-6">
        <div class="glass-panel p-5 rounded-2xl flex flex-col items-center justify-center border border-white/5">
            <span class="text-2xl font-bold text-white">${currentUser.referral_count}</span>
            <span class="text-[10px] text-gray-400 uppercase mt-1">Total Refers</span>
        </div>
        <div class="glass-panel p-5 rounded-2xl flex flex-col items-center justify-center border border-white/5">
            <span class="text-2xl font-bold text-green-400">Active</span>
            <span class="text-[10px] text-gray-400 uppercase mt-1">Account Status</span>
        </div>
    </div>
    
    ${appSettings.home_banner_url ? `<img src="${appSettings.home_banner_url}" class="w-full h-32 object-cover rounded-xl mt-6 border border-white/10 shadow-lg">` : ''}`;
}

async function renderTasks(c) {
    c.innerHTML = `<div class="flex justify-center mt-20"><div class="loader"></div></div>`;
    
    const { data: tasks } = await supabase.from('tasks').select('*').eq('is_active', true).order('id');
    const { data: logs } = await supabase.from('task_logs').select('task_id').eq('user_id', currentUser.id).eq('created_at', new Date().toISOString().split('T')[0]);
    
    const counts = {}; 
    if(logs) logs.forEach(l => counts[l.task_id] = (counts[l.task_id] || 0) + 1);
    const limit = appSettings.daily_task_limit;

    let html = `<div class="space-y-4 mt-4 pb-20">`;
    
    if (tasks && tasks.length > 0) {
        tasks.forEach(t => {
            const done = counts[t.id] || 0;
            const disabled = done >= limit;
            let icon = (t.task_type === 'video' || t.task_type === 'rewarded_ads') ? 'play-circle' : 'globe';
            
            html += `
            <div class="glass-panel p-4 rounded-2xl flex justify-between items-center ${disabled ? 'opacity-50 grayscale' : ''}">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-[#FFD700] text-xl border border-white/5"><i class="fas fa-${icon}"></i></div>
                    <div>
                        <h4 class="font-bold text-white text-sm">${t.title}</h4>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-xs text-[#FFD700] font-bold border border-[#FFD700]/30 px-2 py-0.5 rounded">+${t.reward}</span>
                            <span class="text-[10px] text-gray-500">${done}/${limit}</span>
                        </div>
                    </div>
                </div>
                <button onclick="handleTask(${t.id}, ${t.reward}, '${t.task_type}', '${t.link}')" 
                    ${disabled?'disabled':''} 
                    class="px-5 py-2.5 rounded-xl text-xs font-bold gold-gradient text-black shadow-lg active:scale-95 transition">
                    ${disabled ? 'Done' : 'Visit'}
                </button>
            </div>`;
        });
    } else {
        html += `<div class="text-center text-gray-500 mt-10">No tasks available right now.</div>`;
    }
    
    c.innerHTML = html + `</div>`;
}

function renderWallet(c) {
    const bdt = (currentUser.balance * appSettings.conversion_rate).toFixed(2);
    
    let opts = ''; 
    if(appSettings.payment_methods) {
        appSettings.payment_methods.forEach(m => opts += `<option value="${m}">${m}</option>`);
    } else {
        opts = `<option value="Bkash Personal">Bkash Personal</option>`;
    }
    
    c.innerHTML = `
    <div class="glass-panel p-6 rounded-2xl text-center mt-4">
        <h1 class="text-4xl font-bold text-white mb-1">\u09F3 ${bdt}</h1>
        <p class="text-xs text-gray-400">Min Withdraw: ${appSettings.min_withdraw_amount} TK</p>
    </div>
    
    <div class="space-y-4 mt-6">
        <div>
            <label class="text-xs text-gray-400 ml-1">Payment Method</label>
            <select id="w-method" class="custom-input">${opts}</select>
        </div>
        <div>
            <label class="text-xs text-gray-400 ml-1">Account Number</label>
            <input type="number" id="w-num" placeholder="017xxxxxxxx" class="custom-input">
        </div>
        <div>
            <label class="text-xs text-gray-400 ml-1">Amount (BDT)</label>
            <input type="number" id="w-amt" placeholder="Amount" class="custom-input">
        </div>
        
        <button id="w-btn" onclick="processWithdraw()" class="w-full py-4 rounded-xl gold-gradient text-black font-bold mt-4 shadow-lg active:scale-95 transition">WITHDRAW REQUEST</button>
    </div>`;
}

async function renderRefer(c) {
    const link = `${location.origin}${location.pathname}?ref=${currentUser.id}`;
    
    // রেফার লিস্ট আনা
    const { data: refers } = await supabase.from('users').select('first_name, created_at, id').eq('referred_by', currentUser.id).order('created_at', {ascending: false});
    
    let hist = '';
    if(refers && refers.length > 0) {
        refers.forEach(u => {
            hist += `
            <div class="flex justify-between items-center bg-white/5 p-3 rounded-lg border border-white/5 mb-2">
                <div>
                    <p class="text-sm font-bold text-white">${u.first_name}</p>
                    <p class="text-[10px] text-gray-500">${u.id}</p>
                </div>
                <p class="text-[10px] text-gray-400">${new Date(u.created_at).toLocaleDateString()}</p>
            </div>`;
        });
    } else {
        hist = `<div class="text-center text-gray-500 text-xs py-4">No referrals yet</div>`;
    }

    c.innerHTML = `
    <div class="glass-panel p-6 rounded-2xl text-center mt-4 border border-[#FFD700]/30 shadow-lg">
        <h2 class="text-2xl font-bold text-white">Refer & Earn</h2>
        <p class="text-xs text-gray-400 mt-2">Get ${appSettings.referral_bonus} points per referral!</p>
    </div>
    
    <div class="glass-panel p-3 rounded-xl mt-6 flex items-center gap-3 bg-black/30 border border-white/10">
        <input type="text" value="${link}" readonly class="bg-transparent text-xs w-full text-white outline-none" id="ref-link">
        <button onclick="copyLink()" class="p-2.5 bg-[#FFD700] rounded-lg text-black"><i class="fas fa-copy"></i></button>
    </div>
    
    <div class="mt-6">
        <h3 class="text-sm font-bold text-gray-400 mb-3 uppercase tracking-wider">Referral History (${refers ? refers.length : 0})</h3>
        <div class="overflow-y-auto max-h-60 space-y-1 pr-1 custom-scroll">
            ${hist}
        </div>
    </div>`;
}

function renderHistory(c) {
    c.innerHTML = `<div class="text-center mt-10"><div class="loader"></div></div>`;
    supabase.from('withdrawals').select('*').eq('user_id', currentUser.id).order('created_at', {ascending:false})
    .then(({data}) => {
        let html = `<div class="space-y-3 mt-4">`;
        if(!data || data.length === 0) html = `<div class="flex flex-col items-center justify-center h-64 opacity-50"><i class="fas fa-history text-4xl mb-3 text-gray-500"></i><p class="text-sm text-gray-400">No transaction history</p></div>`;
        else data.forEach(i => {
            let statusColor = i.status === 'paid' ? 'text-green-400' : (i.status === 'rejected' ? 'text-red-400' : 'text-yellow-400');
            let borderColor = i.status === 'paid' ? 'border-green-500' : (i.status === 'rejected' ? 'border-red-500' : 'border-yellow-500');
            
            html += `
            <div class="glass-panel p-4 rounded-xl flex justify-between items-center border-l-4 ${borderColor}">
                <div>
                    <h4 class="font-bold text-white">\u09F3 ${i.amount_bdt}</h4>
                    <p class="text-[10px] text-gray-400">${i.method} - ${new Date(i.created_at).toLocaleDateString()}</p>
                </div>
                <span class="text-[10px] font-bold px-2 py-1 rounded bg-white/10 uppercase ${statusColor}">${i.status}</span>
            </div>`;
        });
        c.innerHTML = html + `</div>`;
    });
}

function copyLink() {
    const copyText = document.getElementById("ref-link");
    copyText.select();
    document.execCommand("copy");
    Swal.fire({ icon: 'success', title: 'Copied!', toast: true, position: 'top', showConfirmButton: false, timer: 1000 });
}

// Start Application
initApp();
