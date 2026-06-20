# Tv Player - App Android (móvil + Android TV)

Wrapper nativo Android sobre la PWA `https://player-tv.pages.dev`.
Es un proyecto de **Android Studio listo para abrir y compilar**: un WebView
con todas las opciones necesarias activas (descargas, fullscreen, file picker,
fullscreen video) y soporte de **Android TV** (Leanback launcher, banner, DPad).

## Compilar con Android Studio

1. **Descarga e instala Android Studio** (cualquier versión moderna, "Hedgehog" o más reciente):
   https://developer.android.com/studio
2. Abre Android Studio → **File → Open** → selecciona la carpeta **`android/`** de este repo.
3. Espera a que se descarguen Gradle y dependencias (la primera vez tarda unos minutos).
4. Conecta tu móvil/Android TV por USB con depuración activada, o usa un emulador.
5. Pulsa el botón **Run ▶** (Shift+F10). Se compila e instala automáticamente.

## Generar APK para distribución

1. **Build → Generate Signed App Bundle / APK**.
2. Elige **APK**.
3. Si es la primera vez, **crea una keystore nueva** (guárdala bien, la necesitarás para futuras actualizaciones):
   - Path: por ejemplo `~/keys/tvplayer.keystore`
   - Password: el que quieras
   - Alias: `tvplayer`
   - Validity: 25 años
   - First and Last name: lo que quieras
4. Selecciona **release**, marca **V1** y **V2 signature**.
5. La APK queda en `android/app/release/app-release.apk`.

## Instalar

- **Móvil**: copia la APK al teléfono y ábrela. Activa "Orígenes desconocidos" si te lo pide.
- **Android TV**: usa una app tipo **"Send Files to TV"** o **"X-plore"**, o sube la APK a Drive
  y descárgala en el TV. Pulsa "Instalar".

## Cómo se actualiza

- Si cambias **la web** (push a `feature/client-only`), la APK se actualiza al instante:
  el WebView siempre carga la versión más reciente de `player-tv.pages.dev`.
- Si quieres cambiar el código nativo (la propia "shell" Android): modifica
  `MainActivity.kt`, sube el `versionCode` y `versionName` en `app/build.gradle.kts`,
  recompila y reinstala con la **misma keystore**.

## Estructura

```
android/
├── settings.gradle.kts        # configuracion raiz
├── build.gradle.kts
├── gradle.properties
└── app/
    ├── build.gradle.kts        # version, dependencias
    └── src/main/
        ├── AndroidManifest.xml # permisos + intent-filters movil/TV
        ├── java/app/playertv/web/
        │   └── MainActivity.kt # WebView + chrome client
        └── res/
            ├── drawable/       # iconos vectoriales y banner TV
            ├── mipmap-anydpi-v26/ # adaptive icon
            └── values/         # strings, colores, theme
```

## Personalizar

- **Cambiar URL de la web**: edita `START_URL` en `MainActivity.kt`.
- **Banner Android TV**: sustituye `res/drawable/banner.xml` por una imagen
  PNG real de 320x180 en `res/drawable-xhdpi/banner.png`.
- **Iconos**: ya tenemos uno generado vectorial. Si quieres usar tus PNG
  reales (`docs/icon_*.png`), copialos a `res/mipmap-mdpi/`, `res/mipmap-hdpi/`...
  con nombre `ic_launcher.png` (48, 72, 96, 144, 192 px respectivamente).
- **Nombre app**: `res/values/strings.xml` (`app_name`).

## Notas

- **No requiere TWA**: usamos WebView directo, así no necesitas configurar
  `assetlinks.json` ni preocuparte por la huella SHA-256.
- **Android TV**: el `<intent-filter>` con `LEANBACK_LAUNCHER` hace que la
  app aparezca en el lanzador del TV. La navegación con DPad funciona porque
  la web ya tiene clases `.focusable` en sus elementos.
- **Fullscreen**: cuando pulsas el botón fullscreen del `<video>`, la app
  oculta status bar y nav bar para reproducir a pantalla completa.
- **Subir vídeos**: el WebView llama al picker del sistema para seleccionar
  archivos cuando la web usa `<input type="file">`.
