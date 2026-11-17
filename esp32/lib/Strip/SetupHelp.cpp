#include "SetupHelp.h"

#include <string.h>

#include "Draw.h"
#include "StripGlyphs.h"

namespace SetupHelp
{
    namespace
    {
        using Draw::Align;
        using Draw::Canvas;
        using Draw::drawText;
        using Draw::plain;
        using Draw::textAdvance;
        using StripGlyphs::Font;

        // Text stays this far from the sides.
        constexpr int Margin = 14;
        constexpr int TextWidth = Width - Margin * 2;

        constexpr int TitleBaseline = 46;
        constexpr int SubtitleBaseline = 78;
        constexpr int QrTop = 106;
        // The QR code is drawn in whole pixels a module, as big as fits in this.
        constexpr int QrMaxSize = 176;
        // Below the QR code, its quiet zone, which scanners need clear.
        constexpr int QrGap = 20;
        constexpr int LineGap = 30;

        int textWidth(const Font& font, const std::string& text)
        {
            // In 1/16 px, rounded up
            return (textAdvance(font, text.c_str()) + 15) / 16;
        }

        // Lines of text under the QR code, centred, one below the other.
        struct Lines
        {
            const Canvas& canvas;
            int baseline;

            void add(const std::string& text)
            {
                // A line that would run into the bottom edge is left out.
                const Font& font = StripGlyphs::helpFont;
                if (baseline + font.size / 4 > Height)
                {
                    return;
                }

                drawText(canvas, font, text.c_str(), Width / 2, baseline, Align::Centre, plain(Strip::Black));
                baseline += LineGap;
            }

            // "Password: value" on one line, or on two when that's too wide.
            void addLabelled(const std::string& label, const std::string& value)
            {
                std::string line = label + " " + value;
                if (textWidth(StripGlyphs::helpFont, line) <= TextWidth)
                {
                    add(line);
                    return;
                }

                add(label);
                add(value);
            }
        };

        // Returns the QR code's bottom edge.
        int drawQr(const Canvas& canvas, const QrCode& qr)
        {
            if (qr.size <= 0)
            {
                return QrTop;
            }

            int scale = QrMaxSize / qr.size;
            if (scale < 1)
            {
                scale = 1;
            }

            int size = qr.size * scale;
            int left = (Width - size) / 2;

            for (int y = 0; y < qr.size; y++)
            {
                for (int x = 0; x < qr.size; x++)
                {
                    if (qr.dark(x, y))
                    {
                        canvas.fillRect(left + x * scale, QrTop + y * scale, scale, scale, Strip::Black);
                    }
                }
            }

            return QrTop + size;
        }

        // Wi-Fi QR codes escape these with a backslash.
        std::string wifiEscaped(const char* text)
        {
            std::string escaped;
            for (const char* character = text; *character; character++)
            {
                if (strchr("\\;,:\"", *character))
                {
                    escaped += '\\';
                }
                escaped += *character;
            }

            return escaped;
        }
    }

    Screen screenFor(bool wifiConnected, bool accessPointOpen)
    {
        if (wifiConnected)
        {
            return Screen::Ready;
        }

        return accessPointOpen ? Screen::JoinWifi : Screen::None;
    }

    std::string qrText(Screen screen, const Details& details)
    {
        switch (screen)
        {
            case Screen::JoinWifi:
                return "WIFI:T:WPA;S:" + wifiEscaped(details.network) +
                    ";P:" + wifiEscaped(details.password) + ";;";
            case Screen::Ready:
                return std::string("http://") + details.ip + "/";
            default:
                return "";
        }
    }

    bool QrCode::dark(int x, int y) const
    {
        if (x < 0 || x >= size || y < 0 || y >= size)
        {
            return false;
        }

        int bit = y * size + x;
        return (modules[bit / 8] & (0x80 >> (bit % 8))) != 0;
    }

    void draw(
        uint8_t* image,
        Screen screen,
        const Details& details,
        const QrCode& qr,
        bool hidePassword
    )
    {
        memset(image, (Strip::White << 4) | Strip::White, Size);
        Canvas canvas{image, Width, Height};

        if (screen == Screen::None)
        {
            return;
        }

        bool joining = screen == Screen::JoinWifi;
        std::string title = joining
            ? std::string("Set up ") + details.tapName
            : std::string(details.tapName) + " is ready";
        drawText(
            canvas,
            StripGlyphs::helpTitleFont,
            title.c_str(),
            Width / 2,
            TitleBaseline,
            Align::Centre,
            plain(Strip::Black)
        );
        drawText(
            canvas,
            StripGlyphs::helpFont,
            joining ? "Scan to join its Wi-Fi" : "Scan to send a picture",
            Width / 2,
            SubtitleBaseline,
            Align::Centre,
            plain(Strip::Black)
        );

        int qrBottom = drawQr(canvas, qr);
        Lines lines{canvas, qrBottom + QrGap + StripGlyphs::helpFont.capHeight};

        if (joining)
        {
            lines.addLabelled("Wi-Fi:", details.network);
            lines.addLabelled("Password:", hidePassword ? "shown on the tap" : details.password);
            lines.add("Then the setup page opens");
        }
        else
        {
            lines.add(details.host);
            lines.add(std::string("or ") + details.ip);
            lines.add("From a device on the same Wi-Fi");
        }
    }
}
