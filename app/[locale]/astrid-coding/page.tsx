"use client"

import { BRAND } from '@/lib/brand/config'
import { Link } from "@/lib/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Heart, Bot, Code, GitBranch, Globe, MessageSquare, CheckCircle, ExternalLink, Zap, Shield, Users, ArrowRight, Star, Play } from "lucide-react"
import { Github } from "@/components/ui/brand-icons"
import { scrollShellClassName } from "@/components/scroll-shell"
import { GITHUB_WEB_URL } from '@/lib/github/host'
import { useTranslations } from '@/lib/i18n/client'

export default function AstridCodingPage() {
  const { t } = useTranslations()
  const handleGetStarted = () => {
    window.open(`${GITHUB_WEB_URL}/apps/${BRAND.githubAppSlug}/installations/new`, '_blank')
  }

  const handleSignUp = () => {
    window.location.href = '/auth/signin'
  }

  return (
    <div className={`${scrollShellClassName} bg-theme-primary bg-gradient-to-br from-brand-subtle via-transparent to-agent-bubble`}>
      {/* Header */}
      <div className="bg-theme-header/80 backdrop-blur-sm border-b border-theme-header sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Heart className="w-8 h-8 text-red-500 fill-red-500" />
              <span className="text-2xl font-bold text-theme-primary">{BRAND.wordmark}</span>
              <Badge variant="outline" className="bg-brand-subtle text-brand border-brand/30">
                {t('settingsPages.codingAgent.title')}
              </Badge>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="outline" onClick={handleSignUp}>
                {t('auth.signUpButton')}
              </Button>
              <Button onClick={handleGetStarted}>
                {t('codingAgentPage.getStarted')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center max-w-4xl mx-auto mb-16">
          <div className="flex items-center justify-center space-x-3 mb-6">
            <Bot className="w-16 h-16 text-brand" />
            <div className="text-left">
              <h1 className="text-5xl font-bold text-theme-primary mb-2">
                {t('codingAgentPage.heroTitle')}
              </h1>
              <p className="text-xl text-theme-muted">
                {t('codingAgentPage.heroSubtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center space-x-4 mb-8">
            <div className="flex items-center space-x-2 text-sm text-theme-muted">
              <Star className="w-4 h-4 text-warning fill-warning" />
              <span>{t('codingAgentPage.badgeProductionReady')}</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-theme-muted">
              <CheckCircle className="w-4 h-4 text-success" />
              <span>{t('codingAgentPage.badgeGithub')}</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-theme-muted">
              <Zap className="w-4 h-4 text-brand" />
              <span>{t('codingAgentPage.badgeAutoDeploy')}</span>
            </div>
          </div>

          <div className="flex items-center justify-center space-x-4">
            <Button size="lg" onClick={handleGetStarted} className="bg-brand hover:bg-brand-hover text-brand-foreground">
              <Play className="w-5 h-5 mr-2" />
              {t('codingAgentPage.installGithubApp')}
            </Button>
            <Button size="lg" variant="outline" onClick={handleSignUp}>
              <ArrowRight className="w-5 h-5 mr-2" />
              {t('codingAgentPage.tryFree')}
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <Card className="bg-theme-surface/60 backdrop-blur-sm border-theme-surface hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <Code className="w-12 h-12 text-brand mx-auto mb-4" />
              <h3 className="font-semibold text-theme-primary mb-2">{t('codingAgentPage.features.codeGenerationTitle')}</h3>
              <p className="text-sm text-theme-muted">
                {t('codingAgentPage.features.codeGenerationDesc')}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-theme-surface/60 backdrop-blur-sm border-theme-surface hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <GitBranch className="w-12 h-12 text-success mx-auto mb-4" />
              <h3 className="font-semibold text-theme-primary mb-2">{t('codingAgentPage.features.githubPrsTitle')}</h3>
              <p className="text-sm text-theme-muted">
                {t('codingAgentPage.features.githubPrsDesc')}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-theme-surface/60 backdrop-blur-sm border-theme-surface hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <Globe className="w-12 h-12 text-purple-500 mx-auto mb-4" />
              <h3 className="font-semibold text-theme-primary mb-2">{t('codingAgentPage.features.livePreviewsTitle')}</h3>
              <p className="text-sm text-theme-muted">
                {t('codingAgentPage.features.livePreviewsDesc')}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-theme-surface/60 backdrop-blur-sm border-theme-surface hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <MessageSquare className="w-12 h-12 text-warning mx-auto mb-4" />
              <h3 className="font-semibold text-theme-primary mb-2">{t('codingAgentPage.features.commentActionsTitle')}</h3>
              <p className="text-sm text-theme-muted">
                {t('codingAgentPage.features.commentActionsDesc')}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* How It Works */}
        <Card className="mb-16 bg-theme-surface/60 backdrop-blur-sm border-theme-surface">
          <CardHeader>
            <CardTitle className="text-2xl text-center text-theme-primary">{t('codingAgentPage.howItWorks.title')}</CardTitle>
            <CardDescription className="text-center text-theme-muted">
              {t('codingAgentPage.howItWorks.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-6">
              {[
                { step: 1, title: t('codingAgentPage.howItWorks.assignTitle'), desc: t('codingAgentPage.howItWorks.assignDesc') },
                { step: 2, title: t('codingAgentPage.howItWorks.planningTitle'), desc: t('codingAgentPage.howItWorks.planningDesc') },
                { step: 3, title: t('codingAgentPage.howItWorks.reviewTitle'), desc: t('codingAgentPage.howItWorks.reviewDesc') },
                { step: 4, title: t('codingAgentPage.howItWorks.generateTitle'), desc: t('codingAgentPage.howItWorks.generateDesc') },
                { step: 5, title: t('codingAgentPage.howItWorks.previewTitle'), desc: t('codingAgentPage.howItWorks.previewDesc') },
                { step: 6, title: t('codingAgentPage.howItWorks.deployTitle'), desc: t('codingAgentPage.howItWorks.deployDesc') }
              ].map((item, index) => (
                <div key={index} className="flex items-start space-x-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-brand-subtle text-brand rounded-full flex items-center justify-center text-sm font-medium">
                    {item.step}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-theme-primary">{item.title}</div>
                    <div className="text-theme-muted">{item.desc}</div>
                  </div>
                  {index < 5 && (
                    <div className="hidden md:block w-px h-12 bg-theme-active mt-4"></div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* GitHub App Benefits */}
        <Card className="mb-16 bg-gradient-to-r from-transparent to-brand-subtle border-theme-surface">
          <CardHeader>
            <div className="flex items-center justify-center space-x-3 mb-4">
              <Github className="w-8 h-8" />
              <CardTitle className="text-2xl text-theme-primary">{t('codingAgentPage.githubApp.title')}</CardTitle>
            </div>
            <CardDescription className="text-center text-theme-muted">
              {t('codingAgentPage.githubApp.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center">
                <Zap className="w-12 h-12 text-brand mx-auto mb-4" />
                <h3 className="font-semibold text-theme-primary mb-2">{t('codingAgentPage.githubApp.quickSetupTitle')}</h3>
                <p className="text-sm text-theme-muted">
                  {t('codingAgentPage.githubApp.quickSetupDesc')}
                </p>
              </div>
              <div className="text-center">
                <Shield className="w-12 h-12 text-success mx-auto mb-4" />
                <h3 className="font-semibold text-theme-primary mb-2">{t('codingAgentPage.githubApp.secureTitle')}</h3>
                <p className="text-sm text-theme-muted">
                  {t('codingAgentPage.githubApp.secureDesc')}
                </p>
              </div>
              <div className="text-center">
                <Users className="w-12 h-12 text-purple-500 mx-auto mb-4" />
                <h3 className="font-semibold text-theme-primary mb-2">{t('codingAgentPage.githubApp.sharedTitle')}</h3>
                <p className="text-sm text-theme-muted">
                  {t('codingAgentPage.githubApp.sharedDesc')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Interactive Actions */}
        <Card className="mb-16 bg-theme-surface/60 backdrop-blur-sm border-warning/30">
          <CardHeader>
            <CardTitle className="text-2xl text-center text-theme-primary">{t('codingAgentPage.controls.title')}</CardTitle>
            <CardDescription className="text-center text-theme-muted">
              {t('codingAgentPage.controls.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-success-subtle rounded-lg border border-success/30">
                <span className="font-semibold text-success">&quot;approve&quot;</span>
                <span className="text-sm text-theme-primary">{t('codingAgentPage.controls.approveDesc')}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-brand-subtle rounded-lg border border-brand/30">
                <span className="font-semibold text-brand">&quot;merge&quot; {t('common.or')} &quot;ship it&quot;</span>
                <span className="text-sm text-theme-primary">{t('codingAgentPage.controls.mergeDesc')}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-warning-subtle rounded-lg border border-warning/30">
                <span className="font-semibold text-warning">&quot;change [feedback]&quot;</span>
                <span className="text-sm text-theme-primary">{t('codingAgentPage.controls.changeDesc')}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA Section */}
        <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white border-0">
          <CardContent className="p-12 text-center">
            <h2 className="text-3xl font-bold mb-4">{t('codingAgentPage.cta.title')}</h2>
            <p className="text-xl mb-8 text-blue-100">
              {t('codingAgentPage.cta.subtitle')}
            </p>
            <div className="flex items-center justify-center space-x-4">
              <Button size="lg" variant="secondary" onClick={handleGetStarted}>
                <Github className="w-5 h-5 mr-2" />
                {t('codingAgentPage.installGithubApp')}
              </Button>
              <Button size="lg" variant="outline" onClick={handleSignUp} className="bg-transparent text-white border-white hover:bg-white hover:text-blue-600">
                <ArrowRight className="w-5 h-5 mr-2" />
                {t('codingAgentPage.cta.startTrial')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      {/* Footer: dark in every theme by design, so its greys stay literal (DESIGN_SYSTEM.md, No honest token) */}
      <div className="bg-gray-900 text-white py-12">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Heart className="w-6 h-6 text-red-500 fill-red-500" />
              <span className="text-xl font-semibold">{BRAND.wordmark}</span>
              <span className="text-gray-400">{t('settingsPages.codingAgent.title')}</span>
            </div>
            <div className="flex items-center space-x-6">
              <a href={`${GITHUB_WEB_URL}/apps/${BRAND.githubAppSlug}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Github className="w-5 h-5" />
              </a>
              <Link href="/auth/signin" className="text-gray-400 hover:text-white transition-colors">
                {t('auth.signInButton')}
              </Link>
              <Link href="/auth/signin" className="text-gray-400 hover:text-white transition-colors">
                {t('auth.signUpButton')}
              </Link>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-gray-400">
            <p>{t('codingAgentPage.footerNote')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}