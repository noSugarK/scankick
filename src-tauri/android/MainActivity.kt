package io.github.nosugark.scankick

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
    private val bars = WindowInsetsCompat.Type.systemBars()
    private val cutout = WindowInsetsCompat.Type.displayCutout()
    private var webView: WebView? = null
    // Safe-area insets in CSS px as "[top,right,bottom,left]"; Android WebView does not fill env(safe-area-inset-*) reliably.
    @Volatile private var safeArea = "[0,0,0,0]"

    override fun onCreate(savedInstanceState: Bundle?) {
        // Light icons until the page reports its edge colors through setLightBars.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        val content = findViewById<View>(android.R.id.content)
        content.setBackgroundColor(Color.parseColor("#0d1f16"))
        ViewCompat.setOnApplyWindowInsetsListener(content) { _, insets ->
            // The page draws under the bars in its own theme colors and pads its content by these values.
            // Landscape hides the bars, so only the cutout is left to avoid.
            val safe = insets.getInsets(if (isLandscape()) cutout else bars or cutout)
            val density = resources.displayMetrics.density
            safeArea = "[${safe.top / density},${safe.right / density},${safe.bottom / density},${safe.left / density}]"
            webView?.evaluateJavascript("dispatchEvent(new Event('safeareachange'))", null)
            // Keep IME insets for the WebView.
            WindowInsetsCompat.Builder(insets)
                .setInsets(bars or cutout, Insets.NONE)
                .setInsetsIgnoringVisibility(bars or cutout, Insets.NONE)
                .setDisplayCutout(null)
                .build()
        }
        applyOrientation()
    }

    override fun onWebViewCreate(webView: WebView) {
        this.webView = webView
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun safeArea(): String = safeArea

            // The page samples its own top/bottom edge colors, so icons stay readable on light and dark themes.
            @JavascriptInterface
            fun setLightBars(top: Boolean, bottom: Boolean) = runOnUiThread {
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = top
                    isAppearanceLightNavigationBars = bottom
                }
            }
        }, "ScanKickAndroid")
    }

    // Tauri's activity handles orientation changes itself instead of being recreated.
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyOrientation()
    }

    private fun isLandscape() = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

    private fun applyOrientation() {
        // Android WebView cannot enter element fullscreen, so landscape goes immersive natively.
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (isLandscape()) hide(bars) else show(bars)
        }
        ViewCompat.requestApplyInsets(findViewById(android.R.id.content))
    }
}
