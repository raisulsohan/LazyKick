# ⚡ LazyKick (v1.0.0)

> **The Ultimate All-in-One Workflow Companion for Adobe Premiere Pro & After Effects.**  
> **Developed By: RaisulSohan** ([raisulsohan.com](https://raisulsohan.com))

---

## 🌟 ওভারভিউ (Overview)

**LazyKick** হলো Premiere Pro এবং After Effects-এর জন্য একটি সার্বক্ষণিক অ্যাসিস্ট্যান্ট CEP এক্সটেনশন। এটি মূলত পূর্বের **QuickPaste**, **QuickBinSync**, এবং **ProjectNotepad**-কে একটি একক, আল্ট্রা-ফাস্ট ও আধুনিক ডার্ক থিম প্যানেলে একত্রিত করেছে এবং সাথে এনেছে একগুচ্ছ নতুন প্রোডাক্টিভ ফিচার।

---

## 🚀 মূল ফিচারসমূহ (Key Features)

### ১. ⚡ Universal QuickPaste (টপ-বারে সর্বদা দৃশ্যমান)
- যেকোনো ট্যাব বা উইন্ডোতে থাকা অবস্থাতেই এক ক্লিকে ক্লিপবোর্ডের স্ক্রিনশট বা ছবি প্রজেক্টের টাইমলাইনে পেস্ট হয়ে যাবে।
- ছবি স্বয়ংক্রিয়ভাবে `<ProjectFolder>/Pasted Images/`-এ সেভ হয়।
- **After Effects:** কারেন্ট CTI-তে লেয়ার যোগ হয়। সাথে অপশনাল **Guide Layer** সাপোর্ট (যা ভুলবশত ফাইনালে রেন্ডার হবে না) এবং **Auto-Fit to Comp**।
- **Premiere Pro:** টাইমলাইনে প্লেহেডের কারেন্ট পজিশনে প্রথম ফাঁকা ভিডিও ট্র্যাকে স্বয়ংক্রিয়ভাবে ক্লিপ বসে যায়।
- **Recent Pastes History:** শেষ পেস্ট করা ছবির থাম্বনেইল গ্যালারি থেকে যেকোনো সময় এক ক্লিকে রি-ইম্পোর্ট করার সুবিধা।

### ২. 📝 Notes & Interactive Tasks (স্মার্ট নোটপ্যাড)
- **প্রজেক্ট ওয়াইজ অটো-সেভ:** প্রজেক্ট সুইচ করার সাথে সাথে সেই প্রজেক্টের নোট ওপেন হয়ে যাবে। Premiere এবং AE একই প্রজেক্টে শেয়ার্ড মেমরি ব্যবহার করে।
- **🌐 Global Scratchpad:** এমন একটি কমন নোট ট্যাব যা সব প্রজেক্টেই থাকবে (যেখানে নিয়মিত ব্যবহৃত ক্লায়েন্ট কোড, হ্যাশট্যাগ, এক্সপোর্ট সেটিংস রাখা যায়)।
- **☑️ Interactive To-Do Checklist:** এডিটিংয়ের টাস্কলিস্ট লিখে এক ক্লিকে সম্পন্ন হওয়া কাজ স্ট্রাইক-থ্রু (Strike-through) করার সুবিধা।
- **⏱️ Live Timecode Stamp:** এক ক্লিকে টাইমলাইনের লাইভ টাইমকোড (যেমন `[00:01:24:12]`) নোটে স্ট্যাম্প হিসেবে যোগ করার সুবিধা।
- **📋 Copy & 📥 Export:** এক ক্লিকে পুরো নোট কপি বা `.txt` ফাইল হিসেবে সেভ করার অপশন।

### ৩. 📂 Watch Bins & Media Sync (অটো মিডিয়া সিঙ্ক)
- কম্পিউটারের যেকোনো ফোল্ডারকে (যেমন: Downloads, SFX, Client Footage) প্রজেক্টের বিনের সাথে লিঙ্ক করে রাখা যায়।
- **Duplicate Protection:** পূর্বে ইম্পোর্ট করা ফাইল স্বয়ংক্রিয়ভাবে স্কিপ হয়।
- **Auto-Sync:** ব্যাকগ্রাউন্ডে স্বয়ংক্রিয়ভাবে প্রতি ৫ সেকেন্ড পর পর নতুন ফাইলের জন্য স্ক্যান করে।
- **Nested Bins:** `Footage/Interviews` লিখলে স্বয়ংক্রিয়ভাবে নেস্টেড বিন তৈরি করে নেয়।
- **Media Filters:** ফোল্ডারে শুধু ভিডিও `[🎬]`, অডিও `[🎵]` বা ইমেজ `[🖼️]` ফিল্টার করে ইম্পোর্ট করার টগল।
- **Fast In-Panel Browser:** কোনো ভারী OS ডায়ালগ ছাড়াই দ্রুত ড্রাইভ ও ফোল্ডার ব্রাউজ করার সুবিধা।
- **📂 Open in Explorer:** প্রতিটি বিনের পাশে এক ক্লিকে পিসির আসল ফোল্ডারটি ওপেন করার বাটন।

---

## 💻 ইনস্টলেশন গাইড (Installation)

### ধাপ ১ — PlayerDebugMode চালু করা (One-Time)
unsigned এক্সটেনশন লোড করার জন্য এটি একবার অন করতে হয়:

* **Windows:** ফোল্ডারের ভেতর থাকা `ENABLE_DEBUG_MODE.bat` ফাইলে ডাবল-ক্লিক করুন।
* **macOS (Terminal):**
  ```bash
  defaults write com.adobe.CSXS.9 PlayerDebugMode 1
  defaults write com.adobe.CSXS.10 PlayerDebugMode 1
  defaults write com.adobe.CSXS.11 PlayerDebugMode 1
  defaults write com.adobe.CSXS.12 PlayerDebugMode 1
  ```

---

### ধাপ ২ — এক্সটেনশন ফোল্ডার কপি করা
পুরো `LazyKick` ফোল্ডারটি কপি করে নিচের লোকেশনে পেস্ট করুন:

* **Windows:**
  ```text
  C:\Users\<Your-Username>\AppData\Roaming\Adobe\CEP\extensions\LazyKick
  ```
  *(বা `Win + R` চেপে `%APPDATA%\Adobe\CEP\extensions\` লিখে Enter দিন)*

* **macOS:**
  ```text
  ~/Library/Application Support/Adobe/CEP/extensions/LazyKick
  ```

---

### ধাপ ৩ — সফটওয়্যার রিস্টার্ট ও ওপেন
1. Premiere Pro বা After Effects চালু করুন।
2. মেনুবার থেকে প্যানেল ওপেন করুন:
   * **Window > Extensions > LazyKick**
3. আপনার ওয়ার্কস্পেসের যেকোনো সুবিধাজনক পাশে ডক (Dock) করে কাজ শুরু করুন!

---

## 👨‍💻 Credits & License

* **Developer:** Raisul Sohan
* **Website:** [https://raisulsohan.com](https://raisulsohan.com)
* **Suite:** LazySuite Ecosystem
* **Copyright:** © 2026 Raisul Sohan. All rights reserved.
