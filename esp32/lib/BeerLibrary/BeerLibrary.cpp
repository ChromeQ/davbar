#include "BeerLibrary.h"

#include <algorithm>
#include <stdio.h>

namespace BeerLibrary
{
    static const size_t IdLength = 8;

    static bool isLowerHex(char character)
    {
        return (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f');
    }

    std::string idFor(uint32_t crc)
    {
        char text[IdLength + 1];
        snprintf(text, sizeof(text), "%08lx", static_cast<unsigned long>(crc));

        return text;
    }

    bool isId(const std::string& text)
    {
        return text.size() == IdLength && std::all_of(text.begin(), text.end(), isLowerHex);
    }

    std::vector<std::string> parseIds(const std::string& list)
    {
        std::vector<std::string> ids;
        size_t start = 0;

        while (start <= list.size())
        {
            size_t end = list.find(',', start);
            if (end == std::string::npos)
            {
                end = list.size();
            }

            std::string id = list.substr(start, end - start);
            if (isId(id) && std::find(ids.begin(), ids.end(), id) == ids.end())
            {
                ids.push_back(id);
            }

            start = end + 1;
        }

        return ids;
    }

    static bool endsWith(const std::string& text, const std::string& ending)
    {
        return text.size() >= ending.size() &&
            text.compare(text.size() - ending.size(), ending.size(), ending) == 0;
    }

    FileKind fileKind(const std::string& name, std::string& id)
    {
        const std::string thumbnail = ".thumb.jpg";
        const std::string image = ".jpg";

        if (name.size() == IdLength + thumbnail.size() && endsWith(name, thumbnail))
        {
            id = name.substr(0, IdLength);
            return isId(id) ? FileKind::Thumbnail : FileKind::None;
        }

        if (name.size() == IdLength + image.size() && endsWith(name, image))
        {
            id = name.substr(0, IdLength);
            return isId(id) ? FileKind::Image : FileKind::None;
        }

        return FileKind::None;
    }

    bool isJpegStart(const uint8_t* data, size_t length)
    {
        return length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF;
    }

    void sortByShown(std::vector<Shown>& beers)
    {
        std::sort(
            beers.begin(),
            beers.end(),
            [](const Shown& a, const Shown& b)
            {
                return a.seconds != b.seconds ? a.seconds > b.seconds : a.id < b.id;
            }
        );
    }

    std::string formatIndex(const std::vector<Shown>& beers)
    {
        std::string text;

        for (const Shown& beer : beers)
        {
            char line[32];
            snprintf(line, sizeof(line), "%s %lld\n", beer.id.c_str(), static_cast<long long>(beer.seconds));
            text += line;
        }

        return text;
    }

    std::vector<Shown> parseIndex(const std::string& text)
    {
        std::vector<Shown> beers;
        size_t start = 0;

        while (start < text.size())
        {
            size_t end = text.find('\n', start);
            if (end == std::string::npos)
            {
                end = text.size();
            }

            std::string line = text.substr(start, end - start);
            size_t space = line.find(' ');
            start = end + 1;

            if (space == std::string::npos)
            {
                continue;
            }

            std::string id = line.substr(0, space);
            std::string seconds = line.substr(space + 1);
            bool digits = !seconds.empty() && seconds.size() <= 18 &&
                std::all_of(seconds.begin(), seconds.end(), [](char c) { return c >= '0' && c <= '9'; });

            bool known = std::any_of(
                beers.begin(),
                beers.end(),
                [&id](const Shown& beer) { return beer.id == id; }
            );

            if (isId(id) && digits && !known)
            {
                beers.push_back({ id, std::stoll(seconds) });
            }
        }

        return beers;
    }

    // "192.168.0.109" as its four numbers, each 0-255 written plainly.
    static bool parseIpv4(const std::string& host, int parts[4])
    {
        size_t start = 0;

        for (int part = 0; part < 4; part++)
        {
            size_t end = part < 3 ? host.find('.', start) : host.size();
            if (end == std::string::npos || end == start || end - start > 3)
            {
                return false;
            }

            int value = 0;
            for (size_t index = start; index < end; index++)
            {
                if (host[index] < '0' || host[index] > '9')
                {
                    return false;
                }
                value = value * 10 + (host[index] - '0');
            }

            if (value > 255)
            {
                return false;
            }

            parts[part] = value;
            start = end + 1;
        }

        return true;
    }

    // Letters, digits, hyphens and dots, as in "davbar-tap2.local".
    static bool isHostName(const std::string& host)
    {
        return !host.empty() && std::all_of(
            host.begin(),
            host.end(),
            [](char character)
            {
                return (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9') ||
                    character == '-' ||
                    character == '.';
            }
        );
    }

    bool isLocalOrigin(const std::string& origin)
    {
        const std::string scheme = "http://";
        if (origin.compare(0, scheme.size(), scheme) != 0)
        {
            return false;
        }

        // An origin is only a scheme, a host and maybe a port.
        std::string host = origin.substr(scheme.size());
        size_t colon = host.find(':');
        if (colon != std::string::npos)
        {
            std::string port = host.substr(colon + 1);
            if (port.empty() || port.size() > 5 ||
                !std::all_of(port.begin(), port.end(), [](char c) { return c >= '0' && c <= '9'; }))
            {
                return false;
            }
            host = host.substr(0, colon);
        }

        if (host == "localhost")
        {
            return true;
        }

        int parts[4];
        if (parseIpv4(host, parts))
        {
            return parts[0] == 10 ||
                parts[0] == 127 ||
                (parts[0] == 172 && parts[1] >= 16 && parts[1] <= 31) ||
                (parts[0] == 192 && parts[1] == 168);
        }

        const std::string local = ".local";
        return isHostName(host) && host.size() > local.size() && endsWith(host, local) &&
            host[host.size() - local.size() - 1] != '.';
    }
}
