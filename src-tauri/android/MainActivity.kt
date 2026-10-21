package io.github.nosugark.scankick

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
    private val bars = WindowInsetsCompat.Type.systemBars()

    override fun onCreate(savedInstanceState: Bundle?) {
        // Light status bar icons on the app's dark background.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        val content = findViewById<View>(android.R.id.content)
        content.setBackgroundColor(Color.parseColor("#0d1f16"))
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            // Portrait keeps the phone's status bar visible above the page; landscape fills the whole screen.
            val safe = if (isLandscape()) Insets.NONE
                else insets.getInsets(bars or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            // The native container owns these insets; keep IME insets for the WebView.
            WindowInsetsCompat.Builder(insets)
                .setInsets(bars or WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
                .setInsetsIgnoringVisibility(bars or WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
                .setDisplayCutout(null)
                .build()
        }
        applyOrientation()
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
