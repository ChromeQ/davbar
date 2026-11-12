#include "Draw.h"

namespace Draw
{
    using StripGlyphs::Font;
    using StripGlyphs::Glyph;
    using StripGlyphs::Icon;

    void Canvas::set(int x, int y, Colour colour) const
    {
        if (x < 0 || x >= width || y < 0 || y >= height)
        {
            return;
        }

        if (colour == Strip::Orange)
        {
            colour = (x + y) % 3 == 0 ? Strip::Yellow : Strip::Red;
        }

        uint8_t& byte = bytes[y * (width / 2) + x / 2];
        byte = x % 2 == 0
            ? static_cast<uint8_t>((byte & 0x0F) | (colour << 4))
            : static_cast<uint8_t>((byte & 0xF0) | colour);
    }

    void Canvas::fillRect(int x, int y, int rectWidth, int rectHeight, Colour colour) const
    {
        for (int j = y; j < y + rectHeight; j++)
        {
            for (int i = x; i < x + rectWidth; i++)
            {
                set(i, j, colour);
            }
        }
    }

    void Canvas::strokeRect(
        int x,
        int y,
        int rectWidth,
        int rectHeight,
        int border,
        Colour colour
    ) const
    {
        fillRect(x, y, rectWidth, border, colour);
        fillRect(x, y + rectHeight - border, rectWidth, border, colour);
        fillRect(x, y, border, rectHeight, colour);
        fillRect(x + rectWidth - border, y, border, rectHeight, colour);
    }

    void Canvas::disc(int centreX, int centreY, int r, Colour colour) const
    {
        int limit = r * r * 10 + r * 6;
        for (int j = -r; j <= r; j++)
        {
            for (int i = -r; i <= r; i++)
            {
                if ((i * i + j * j) * 10 <= limit)
                {
                    set(centreX + i, centreY + j, colour);
                }
            }
        }
    }

    TextColour plain(Colour colour)
    {
        return {colour, colour, 0};
    }

    void drawBits(
        const Canvas& canvas,
        const uint8_t* bits,
        int width,
        int height,
        int x,
        int y,
        TextColour colour
    )
    {
        int rowBytes = (width + 7) / 8;
        for (int j = 0; j < height; j++)
        {
            for (int i = 0; i < width; i++)
            {
                if (bits[j * rowBytes + i / 8] & (0x80 >> (i % 8)))
                {
                    int px = x + i;
                    canvas.set(px, y + j, px < colour.split ? colour.before : colour.after);
                }
            }
        }
    }

    void drawIcon(const Canvas& canvas, const Icon& icon, int x, int y, Colour colour)
    {
        drawBits(canvas, icon.bits, icon.width, icon.height, x, y, plain(colour));
    }

    namespace
    {
        const Glyph* findGlyph(const Font& font, char character)
        {
            uint8_t code = static_cast<uint8_t>(character);
            for (uint8_t i = 0; i < font.glyphCount; i++)
            {
                if (font.glyphs[i].code == code)
                {
                    return &font.glyphs[i];
                }
            }

            return nullptr;
        }

        int kerning(const Font& font, char first, char second)
        {
            for (uint16_t i = 0; i < font.kerningCount; i++)
            {
                const StripGlyphs::Kerning& pair = font.kerning[i];
                if (
                    pair.first == static_cast<uint8_t>(first) &&
                    pair.second == static_cast<uint8_t>(second)
                )
                {
                    return pair.adjust;
                }
            }

            return 0;
        }
    }

    int32_t textAdvance(const Font& font, const char* text)
    {
        int32_t advance = 0;
        for (const char* character = text; *character; character++)
        {
            const Glyph* glyph = findGlyph(font, *character);
            if (glyph)
            {
                advance += glyph->advance + kerning(font, character[0], character[1]);
            }
        }

        return advance;
    }

    void drawText(
        const Canvas& canvas,
        const Font& font,
        const char* text,
        int x,
        int baseline,
        Align align,
        TextColour colour
    )
    {
        int32_t advance = textAdvance(font, text);
        int32_t pen = x * 16;
        if (align == Align::Centre)
        {
            pen -= advance / 2;
        }
        else if (align == Align::Right)
        {
            pen -= advance;
        }

        for (const char* character = text; *character; character++)
        {
            const Glyph* glyph = findGlyph(font, *character);
            if (!glyph)
            {
                continue;
            }

            drawBits(
                canvas,
                font.bits + glyph->offset,
                glyph->width,
                glyph->height,
                ((pen + 8) >> 4) + glyph->left,
                baseline + glyph->top,
                colour
            );
            pen += glyph->advance + kerning(font, character[0], character[1]);
        }
    }
}
