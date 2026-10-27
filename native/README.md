# Grdlabs – تطبيق الهاتف (Android و iPhone)

مشروع [Capacitor](https://capacitorjs.com) يغلّف واجهة `mobile/index.html` كتطبيق أصلي.
أي تعديل على `mobile/index.html` ينتقل للتطبيق بـ `npm run sync`.

```
native/
  android/   مشروع Android Studio
  ios/       مشروع Xcode (iPhone)
  assets/    الأيقونة وشاشة البداية (المصدر)
  scripts/copy-web.mjs   ينسخ الواجهة إلى www/
```

## Android

**ملف APK جاهز:** كل تعديل يُرفع على GitHub يبني APK تلقائياً.
من صفحة المستودع: Actions ← Mobile apps ← آخر تشغيل ← Artifacts ← `grdlabs-android`.
فك الضغط وانقل `grdlabs.apk` للموبايل وثبّته (اسمح بالتثبيت من مصادر غير معروفة).

**البناء على حاسبتك:** ثبّت Node 22 و Android Studio، وبعدين:

```
cd native
npm install
npm run android      # يفتح المشروع بـ Android Studio ← Run
```

للنشر على Google Play: Android Studio ← Build ← Generate Signed App Bundle، وارفع ملف `.aab` على Play Console.

## iPhone

يحتاج جهاز Mac فيه Xcode 26 أو أحدث.

```
cd native
npm install
npm run ios          # يفتح المشروع بـ Xcode
```

بـ Xcode: اختار مشروع App ← Signing & Capabilities ← Team (حساب Apple)، وبعدين شغّله على الآيفون.
للنشر على App Store: Product ← Archive ← Distribute App (يحتاج حساب Apple Developer).

## معلومات التطبيق

- المعرّف: `site.grdlabs.app`
- الاسم: Grdlabs
- الأيقونة وشاشة البداية تتولّد من `assets/` بالأمر:
  `npx capacitor-assets generate --android --ios`
