"""One request over stdin/stdout; no listening port, screenshots, transcripts or keys on disk.

The Mac app starts /usr/bin/python3 -B with XJ_WORKSPACE pointing at the workspace.
Only this process reads gateway/models credentials. Errors never include upstream bodies.
"""
import base64
import json
import math
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

MAX_INPUT = 3_000_000
FACES = {'neutral', 'smile', 'happy', 'curious', 'shy', 'touched', 'sleepy', 'surprised', 'pout'}
MOTIONS = {'', 'head_tilt', 'wave', 'nod_yes', 'think', 'clap', 'tail_wag'}
SYSTEM = Path(__file__).with_name('system.txt').read_text()


class RequestError(Exception):
    pass


def short(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ''


def prepare(data):
    if not isinstance(data, dict) or data.get('kind') not in ('observe', 'peek', 'chat'):
        raise RequestError('invalid_input')
    kind = data['kind']
    context = {'kind': kind, 'recent_context': short(data.get('recent_context'), 100)}
    context['history'] = [
        {'role': row['role'], 'text': short(row.get('text'), 500)}
        for row in data.get('history', [])[-8:]
        if isinstance(row, dict) and row.get('role') in ('user', 'assistant')
    ] if isinstance(data.get('history', []), list) else []
    content = []
    if kind == 'chat':
        context['user_text'] = short(data.get('text'), 500)
        if not context['user_text']:
            raise RequestError('empty_message')
        # A reply never silently includes a screenshot, even if a caller supplies one.
    else:
        image = data.get('image')
        if not isinstance(image, dict) or image.get('media_type') not in ('image/jpeg', 'image/png'):
            raise RequestError('invalid_image')
        encoded = image.get('data')
        if not isinstance(encoded, str) or len(encoded) > 2_800_000:
            raise RequestError('invalid_image')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except ValueError:
            raise RequestError('invalid_image')
        signature = b'\x89PNG\r\n\x1a\n' if image['media_type'] == 'image/png' else b'\xff\xd8\xff'
        if not raw.startswith(signature):
            raise RequestError('invalid_image')
        content.append({'type': 'image', 'source': {'type': 'base64', **image}})
        observation = data.get('observation', {})
        context['observation'] = {'app': short(observation.get('app'), 80),
                                  'locate': observation.get('locate') is True} if isinstance(observation, dict) else {}
    content.append({'type': 'text', 'text': json.dumps(context, ensure_ascii=False)})
    return content


def parse_reply(text, language="zh"):
    text = text.strip()
    if text.startswith('```') and text.endswith('```'):
        text = text.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    try:
        reply = json.loads(text)
    except (ValueError, TypeError):
        raise RequestError('invalid_model_reply')
    if not isinstance(reply, dict) or type(reply.get('speak')) is not bool:
        raise RequestError('invalid_model_reply')
    said = short(reply.get('text'), 240 if language == 'en' else 80) if reply['speak'] else ''
    if reply['speak'] and not said:
        raise RequestError('invalid_model_reply')
    emotion, motion = reply.get('emotion'), reply.get('motion')
    focus = reply.get('focus')
    if not (said and isinstance(focus, dict) and all(type(focus.get(k)) in (int, float) and
            math.isfinite(focus[k]) and 0 <= focus[k] <= 1 for k in ('x', 'y'))):
        focus = None
    else:
        focus = {k: float(focus[k]) for k in ('x', 'y')}
    return {'ok': True, 'speak': bool(said), 'text': said,
            'emotion': emotion if isinstance(emotion, str) and emotion in FACES else 'neutral',
            'motion': motion if isinstance(motion, str) and motion in MOTIONS and said else '',
            'context': short(reply.get('context'), 100), 'focus': focus}


def generate(data):
    content = prepare(data)
    root = Path(os.environ.get('XJ_WORKSPACE', Path(__file__).resolve().parents[3]))
    sys.path.insert(0, str(root / 'gateway' / 'models'))
    from workspace_models import provider_config, NoRedirect
    config = provider_config('claude')
    key = config['env'][config['keyEnv']]
    payload = {'model': config['model'], 'max_tokens': 500, 'system': SYSTEM + ('\nReply in English. The text field must be natural English, even if the screenshot or previous conversation is Chinese.' if data.get('language') == 'en' else '\n使用简体中文回复，即使画面或历史对话是英文。'),
               'messages': [{'role': 'user', 'content': content}]}
    request = urllib.request.Request(config['baseUrl'].rstrip('/') + '/v1/messages',
        data=json.dumps(payload, ensure_ascii=False).encode(), method='POST',
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key,
                 'x-api-key': key, 'anthropic-version': '2023-06-01'})
    # One attempt. In particular, timeouts and uncertain paid results are never retried.
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=45) as response:
            result = json.loads(response.read(256_000))
    except urllib.error.HTTPError as error:
        raise RequestError('model_http_' + str(error.code))
    except (OSError, ValueError):
        raise RequestError('model_result_uncertain')
    if result.get('stop_reason') != 'end_turn':
        raise RequestError('model_result_incomplete')
    text = ''.join(c.get('text', '') for c in result.get('content', []) if c.get('type') == 'text')
    reply = parse_reply(text, data.get("language", "zh"))
    if data['kind'] == 'chat':
        reply['context'] = ''
    observation = data.get('observation')
    if data['kind'] == 'chat' or not isinstance(observation, dict) or observation.get('locate') is not True:
        reply['focus'] = None
    return reply


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise RequestError('input_too_large')
        result = generate(json.loads(raw))
    except RequestError as error:
        result = {'ok': False, 'error': str(error)}
    except Exception:
        result = {'ok': False, 'error': 'local_configuration_or_input_error'}
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
