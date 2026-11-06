{{- define "kickabout.name" -}}{{ .Release.Name }}{{- end }}
{{- define "kickabout.labels" -}}
app.kubernetes.io/name: kickabout
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}
{{- define "kickabout.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- define "kickabout.oauthSecret" -}}
{{- .Values.api.oauth.existingSecret | default (printf "%s-oauth" .Release.Name) }}
{{- end }}
